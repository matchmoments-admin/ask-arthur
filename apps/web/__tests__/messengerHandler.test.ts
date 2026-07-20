import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnalysisResult } from "@askarthur/types";

// Messenger handler behaviour: the link-preview bug fix (a message with a URL
// must still be analysed), the typing indicator, and the Marketplace
// "send their profile" multi-turn flow (message text + profile screenshot →
// one combined verdict).

// Hoisted so the vi.mock factories (which vitest lifts to the top of the file)
// can reference these without a temporal-dead-zone error.
const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    analyzeForBotDetailed: vi.fn(),
    sendTextMessage: vi.fn(),
    sendQuickReplies: vi.fn(),
    sendTypingOn: vi.fn(),
    downloadMessengerAttachment: vi.fn(),
    stashBotReport: vi.fn(),
    // Mutable so individual tests can flip Marketplace mode.
    featureFlags: { botMarketplaceMode: false },
    store,
    fakeRedis: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return "OK";
      },
      getdel: async (k: string) => {
        const v = store.get(k) ?? null;
        store.delete(k);
        return v;
      },
      del: async (k: string) => {
        store.delete(k);
      },
    },
  };
});
const {
  analyzeForBotDetailed,
  sendTextMessage,
  sendQuickReplies,
  sendTypingOn,
  downloadMessengerAttachment,
  featureFlags,
  store,
} = h;

vi.mock("@askarthur/bot-core/analyze", () => ({ analyzeForBotDetailed: h.analyzeForBotDetailed }));
vi.mock("@askarthur/bot-core/format-messenger", () => ({
  toMessengerMessage: (r: AnalysisResult) => r.summary,
}));
vi.mock("@askarthur/bot-core/rate-limit", () => ({
  checkBotRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: h.featureFlags }));
vi.mock("@/lib/bots/messenger/api", () => ({
  sendTextMessage: h.sendTextMessage,
  sendQuickReplies: h.sendQuickReplies,
  sendTypingOn: h.sendTypingOn,
}));
vi.mock("@/lib/bots/messenger/media", () => ({
  downloadMessengerAttachment: h.downloadMessengerAttachment,
}));
vi.mock("@/lib/bots/replay-dedup", () => ({ isReplay: async () => false }));
vi.mock("@/lib/bots/redis", () => ({ getBotRedis: () => h.fakeRedis }));
vi.mock("@/lib/bots/onward-report", () => ({
  stashBotReport: h.stashBotReport,
  buildReportStash: () => ({ scamReportId: 1 }),
  reportBotScam: async () => "reported",
}));

import { handleMessengerWebhook } from "@/lib/bots/messenger/handler";

function textEvent(text: string, attachments?: unknown[]) {
  return {
    object: "page",
    entry: [
      {
        messaging: [
          { sender: { id: "user-1" }, message: { mid: `m-${Math.round(text.length)}-${text.slice(0, 4)}`, text, attachments } },
        ],
      },
    ],
  };
}

function imageEvent(url: string) {
  return {
    object: "page",
    entry: [
      {
        messaging: [
          {
            sender: { id: "user-1" },
            message: { mid: `img-${url.length}`, attachments: [{ type: "image", payload: { url } }] },
          },
        ],
      },
    ],
  };
}

const SUSPICIOUS = {
  verdict: "SUSPICIOUS",
  confidence: 0.7,
  summary: "Looks like a marketplace scam.",
  redFlags: [],
  nextSteps: [],
} as unknown as AnalysisResult;

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  featureFlags.botMarketplaceMode = false;
  analyzeForBotDetailed.mockResolvedValue({ result: SUSPICIOUS, scamReportId: 1 });
  downloadMessengerAttachment.mockResolvedValue("ZmFrZQ==");
});

describe("link-preview bug fix", () => {
  it("analyses text even when a link-preview 'fallback' attachment rides along", async () => {
    // Messenger attaches a fallback preview to any message containing a URL.
    await handleMessengerWebhook(
      textEvent("AusPost: parcel on hold, pay $3.20 http://bit.ly/x", [
        { type: "fallback", payload: { url: "http://bit.ly/x" }, title: "bit.ly" },
      ]) as never,
    );

    expect(analyzeForBotDetailed).toHaveBeenCalledOnce();
    expect(analyzeForBotDetailed.mock.calls[0][0]).toContain("bit.ly/x");
    // Must NOT have sent the "unsupported attachment" bail.
    expect(sendTextMessage).not.toHaveBeenCalledWith(
      "user-1",
      expect.stringContaining("I can only check text and image"),
    );
  });

  it("still bails on a non-image attachment when there is no text", async () => {
    await handleMessengerWebhook({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-1" },
              message: { mid: "vid-1", attachments: [{ type: "video", payload: { url: "http://x/v.mp4" } }] },
            },
          ],
        },
      ],
    } as never);

    expect(analyzeForBotDetailed).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith(
      "user-1",
      expect.stringContaining("I can only check text and image"),
    );
  });
});

describe("typing indicator", () => {
  it("shows typing before a text analysis", async () => {
    await handleMessengerWebhook(textEvent("is this legit?") as never);
    expect(sendTypingOn).toHaveBeenCalledWith("user-1");
  });
});

describe("Marketplace deeper-check flow", () => {
  it("offers 'Check their profile' + stashes the message when marketplace mode is on", async () => {
    featureFlags.botMarketplaceMode = true;
    await handleMessengerWebhook(textEvent("still available? I'll send a courier") as never);

    const replies = sendQuickReplies.mock.calls[0][2] as Array<{ payload: string }>;
    expect(replies.some((r) => r.payload === "action:profile")).toBe(true);
    // The message text is stashed for the follow-up screenshot.
    expect([...store.keys()].some((k) => k.startsWith("messenger:pending:"))).toBe(true);
  });

  it("does NOT offer the profile check when marketplace mode is off", async () => {
    featureFlags.botMarketplaceMode = false;
    await handleMessengerWebhook(textEvent("still available?") as never);
    const replies = sendQuickReplies.mock.calls[0][2] as Array<{ payload: string }>;
    expect(replies.some((r) => r.payload === "action:profile")).toBe(false);
  });

  it("analyses the earlier message text TOGETHER with a follow-up profile screenshot", async () => {
    featureFlags.botMarketplaceMode = true;

    // 1) text verdict → stashes pending
    await handleMessengerWebhook(textEvent("wants to pay via PayID before pickup") as never);
    analyzeForBotDetailed.mockClear();

    // 2) profile screenshot → combined analysis (text + image in one call)
    await handleMessengerWebhook(imageEvent("https://cdn.fb/profile.jpg") as never);

    expect(analyzeForBotDetailed).toHaveBeenCalledOnce();
    const [prompt, , images] = analyzeForBotDetailed.mock.calls[0];
    expect(prompt).toContain("PayID"); // the earlier message, not the generic image prompt
    expect(images).toEqual(["ZmFrZQ=="]);
    // pending key consumed (getdel)
    expect([...store.keys()].some((k) => k.startsWith("messenger:pending:"))).toBe(false);
  });
});
