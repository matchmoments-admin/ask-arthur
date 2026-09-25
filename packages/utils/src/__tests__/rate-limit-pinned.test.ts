import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins the OBSERVABLE behaviour of every exported limiter in rate-limit.ts:
// the Upstash config each one builds (prefix, sliding-window limit + window,
// analytics, timeout), the key it passes to `.limit()`, and the exact result
// objects for allowed / exceeded / store-unavailable (both "no URL" and "store
// threw"), plus the default fail mode per environment. Written against the
// hand-rolled limiters BEFORE the defineLimiter refactor and left unchanged
// by it — so a green run is the behaviour-preservation proof.

const upstash = vi.hoisted(() => {
  const constructed: Array<Record<string, unknown>> = [];
  const limitImpl = vi.fn<
    (prefix: string, key: string) => Promise<{ success: boolean; remaining: number; reset: number }>
  >();
  class Ratelimit {
    prefix: string;
    constructor(cfg: Record<string, unknown>) {
      this.prefix = cfg.prefix as string;
      const { redis: _redis, ...rest } = cfg;
      constructed.push(rest);
    }
    limit(key: string) {
      return limitImpl(this.prefix, key);
    }
    static slidingWindow(tokens: number, window: string) {
      return { kind: "sliding", tokens, window };
    }
  }
  return { constructed, limitImpl, Ratelimit };
});

vi.mock("@upstash/ratelimit", () => ({ Ratelimit: upstash.Ratelimit }));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(_: unknown) {}
  },
}));
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import * as rl from "../rate-limit";
import { hashIdentifier } from "../hash";

const RESET = 1_790_000_000_000;

type Case = {
  name: string;
  call: (failMode?: rl.FailMode) => Promise<rl.RateLimitResult>;
  prefix: string;
  tokens: number;
  window: string;
  analytics?: boolean;
  timeout?: number;
  key: () => Promise<string> | string;
  message: string;
  /** Limiters written after 2026-05 set `reason` on ok/exceeded too. */
  reasonOnDecision: boolean;
  /** Admin triage takes no failMode and always fails open. */
  alwaysOpen?: boolean;
};

const pf = (bucket: Parameters<typeof rl.checkPhoneFootprintRateLimit>[0], prefix: string, tokens: number, window: string): Case => ({
  name: `checkPhoneFootprintRateLimit:${bucket}`,
  call: (m) => rl.checkPhoneFootprintRateLimit(bucket, "id-1", m),
  prefix, tokens, window, analytics: true,
  key: () => "id-1",
  message: "Too many requests. Please try again later.",
  reasonOnDecision: false,
});
const bd = (bucket: Parameters<typeof rl.checkBreachDefenceRateLimit>[0], prefix: string, tokens: number, window: string): Case => ({
  name: `checkBreachDefenceRateLimit:${bucket}`,
  call: (m) => rl.checkBreachDefenceRateLimit(bucket, "id-1", m),
  prefix, tokens, window, analytics: true,
  key: () => "id-1",
  message: "Too many requests. Please try again later.",
  reasonOnDecision: false,
});
const cc = (bucket: Parameters<typeof rl.checkCharityCheckRateLimit>[0], prefix: string, tokens: number, window: string): Case => ({
  name: `checkCharityCheckRateLimit:${bucket}`,
  call: (m) => rl.checkCharityCheckRateLimit(bucket, "id-1", m),
  prefix, tokens, window, analytics: true,
  key: () => "id-1",
  message: "Too many requests. Please try again later.",
  reasonOnDecision: false,
});
const ss = (bucket: Parameters<typeof rl.checkShopSignalRateLimit>[0], prefix: string, tokens: number, window: string): Case => ({
  name: `checkShopSignalRateLimit:${bucket}`,
  call: (m) => rl.checkShopSignalRateLimit(bucket, "id-1", m),
  prefix, tokens, window, analytics: true,
  key: () => "id-1",
  message: "Too many shop checks. Please try again later.",
  reasonOnDecision: true,
});

const CASES: Case[] = [
  {
    name: "checkImageUploadRateLimit",
    call: (m) => rl.checkImageUploadRateLimit("1.2.3.4", m),
    prefix: "askarthur:image-upload", tokens: 5, window: "1 h", analytics: true, timeout: 1000,
    key: () => "ip:1.2.3.4",
    message: "Too many image uploads. Try again later.",
    reasonOnDecision: false,
  },
  {
    name: "checkDocumentUploadRateLimit",
    call: (m) => rl.checkDocumentUploadRateLimit("1.2.3.4", m),
    prefix: "askarthur:doc-upload", tokens: rl.DOCUMENT_UPLOAD_LIMIT_PER_HOUR, window: "1 h", analytics: true, timeout: 1000,
    key: () => "ip:1.2.3.4",
    message: "Too many document checks. Try again later.",
    reasonOnDecision: false,
  },
  {
    name: "checkDeepfakeRateLimit",
    call: (m) => rl.checkDeepfakeRateLimit("1.2.3.4", m),
    prefix: "askarthur:deepfake", tokens: rl.DEEPFAKE_LIMIT_PER_HOUR, window: "1 h", analytics: true, timeout: 1000,
    key: () => "ip:1.2.3.4",
    message: "Too many audio checks. Try again later.",
    reasonOnDecision: false,
  },
  {
    name: "checkFormRateLimit",
    call: (m) => rl.checkFormRateLimit("1.2.3.4", m),
    prefix: "askarthur:form", tokens: 5, window: "1 h",
    key: () => "1.2.3.4",
    message: "Too many submissions. Please try again later.",
    reasonOnDecision: false,
  },
  pf("anon_burst", "askarthur:pf:anon:burst", 3, "1 h"),
  pf("anon_daily", "askarthur:pf:anon:daily", 10, "24 h"),
  pf("user", "askarthur:pf:user", 60, "1 m"),
  pf("verify_otp_phone", "askarthur:pf:otp:phone", 3, "24 h"),
  pf("verify_otp_ip", "askarthur:pf:otp:ip", 10, "24 h"),
  pf("org_fleet_bulk", "askarthur:pf:fleet:bulk", 3, "1 h"),
  pf("msisdn_cross_ip", "askarthur:pf:xip", 3, "24 h"),
  pf("pdf_render", "askarthur:pf:pdf", 5, "24 h"),
  bd("bd_lookup", "askarthur:bd:lookup", 5, "1 h"),
  bd("bd_extension", "askarthur:bd:ext", 60, "1 m"),
  bd("bd_b2b", "askarthur:bd:b2b", 30, "1 m"),
  cc("cc_lookup", "askarthur:cc:lookup", 5, "1 h"),
  cc("cc_autocomplete", "askarthur:cc:autocomplete", 60, "1 m"),
  ss("sc_deep_check", "askarthur:shop:deep-check", 5, "10 m"),
  ss("sc_poll", "askarthur:shop:poll", 120, "1 m"),
  {
    name: "checkOrgInviteAcceptRateLimit",
    call: (m) => rl.checkOrgInviteAcceptRateLimit("user-1", m),
    prefix: "askarthur:org-invite-accept", tokens: 10, window: "1 h", analytics: true,
    key: () => "user-1",
    message: "Too many invite-accept attempts. Try again later.",
    reasonOnDecision: true,
  },
  {
    name: "checkOrgInviteSendRateLimit",
    call: (m) => rl.checkOrgInviteSendRateLimit("user-1", m),
    prefix: "askarthur:org-invite-send", tokens: 20, window: "24 h", analytics: true,
    key: () => "user-1",
    message: "Too many invitations sent. Try again later.",
    reasonOnDecision: true,
  },
  {
    name: "checkInboundScanRateLimit",
    call: (m) => rl.checkInboundScanRateLimit("  Alice+Promo@Gmail.com ", m),
    prefix: "askarthur:inbound-scan", tokens: 3, window: "1 d", analytics: true,
    key: () => "alice@gmail.com",
    message:
      "You've hit today's free-forward limit (3 per day). Paste suspicious messages at askarthur.au any time — no daily cap on the web scanner.",
    reasonOnDecision: true,
  },
  {
    name: "checkAdminTriageRateLimit",
    call: () => rl.checkAdminTriageRateLimit("admin-token-sha"),
    prefix: "askarthur:clone-watch:triage", tokens: 200, window: "5 m", analytics: false,
    key: () => hashIdentifier("admin-token-sha", "clone-watch-triage"),
    message: "rate_limited",
    reasonOnDecision: true,
    alwaysOpen: true,
  },
];

const withReason = (c: Case, r: "ok" | "exceeded") => (c.reasonOnDecision ? { reason: r } : {});

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
  vi.stubEnv("NODE_ENV", "test");
  upstash.limitImpl.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe.each(CASES)("$name", (c) => {
  it("builds its Upstash limiter with the pinned config", async () => {
    upstash.limitImpl.mockResolvedValue({ success: true, remaining: 4, reset: RESET });
    await c.call();
    const cfg = upstash.constructed.find((k) => k.prefix === c.prefix);
    expect(cfg).toBeDefined();
    expect(cfg!.limiter).toEqual({ kind: "sliding", tokens: c.tokens, window: c.window });
    expect(cfg!.analytics).toBe(c.analytics);
    expect(cfg!.timeout).toBe(c.timeout);
    // One instance per bucket, reused.
    expect(upstash.constructed.filter((k) => k.prefix === c.prefix)).toHaveLength(1);
  });

  it("limits on the pinned key", async () => {
    upstash.limitImpl.mockResolvedValue({ success: true, remaining: 4, reset: RESET });
    await c.call();
    expect(upstash.limitImpl).toHaveBeenCalledWith(c.prefix, await c.key());
  });

  it("allowed → exact result", async () => {
    upstash.limitImpl.mockResolvedValue({ success: true, remaining: 4, reset: RESET });
    expect(await c.call()).toEqual({ allowed: true, remaining: 4, resetAt: null, ...withReason(c, "ok") });
  });

  it("exceeded → exact result", async () => {
    upstash.limitImpl.mockResolvedValue({ success: false, remaining: 0, reset: RESET });
    expect(await c.call()).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: new Date(RESET),
      message: c.message,
      ...withReason(c, "exceeded"),
    });
  });

  it("store threw → store_unavailable in the requested mode", async () => {
    upstash.limitImpl.mockRejectedValue(new Error("boom"));
    const open = { allowed: true, remaining: 99, resetAt: null, reason: "store_unavailable" };
    const closed = {
      allowed: false,
      remaining: 0,
      resetAt: null,
      message: "Service temporarily unavailable.",
      reason: "store_unavailable",
    };
    if (c.alwaysOpen) {
      expect(await c.call()).toEqual(open);
      return;
    }
    expect(await c.call("open")).toEqual(open);
    expect(await c.call("closed")).toEqual(closed);
  });

  it("no store URL → default fail mode: closed in production, open otherwise", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    const open = { allowed: true, remaining: 99, resetAt: null, reason: "store_unavailable" };
    vi.stubEnv("NODE_ENV", "development");
    expect(await c.call()).toEqual(open);
    vi.stubEnv("NODE_ENV", "production");
    if (c.alwaysOpen) {
      expect(await c.call()).toEqual(open);
    } else {
      expect(await c.call()).toMatchObject({ allowed: false, reason: "store_unavailable" });
    }
    expect(upstash.limitImpl).not.toHaveBeenCalled();
  });
});

describe("checkRateLimit (two-tier burst + daily)", () => {
  const key = () => hashIdentifier("1.2.3.4", "UA");

  it("builds both tiers with the pinned config", async () => {
    upstash.limitImpl.mockResolvedValue({ success: true, remaining: 2, reset: RESET });
    await rl.checkRateLimit("1.2.3.4", "UA");
    const burst = upstash.constructed.find((k) => k.prefix === "askarthur:burst");
    const daily = upstash.constructed.find((k) => k.prefix === "askarthur:daily");
    expect(burst!.limiter).toEqual({ kind: "sliding", tokens: 3, window: "1 h" });
    expect(daily!.limiter).toEqual({ kind: "sliding", tokens: 10, window: "24 h" });
    expect(burst!.analytics).toBeUndefined();
    expect(daily!.analytics).toBeUndefined();
  });

  it("allowed → min remaining across tiers, hashed key on both", async () => {
    upstash.limitImpl.mockImplementation(async (prefix) =>
      prefix === "askarthur:burst"
        ? { success: true, remaining: 2, reset: RESET }
        : { success: true, remaining: 7, reset: RESET },
    );
    expect(await rl.checkRateLimit("1.2.3.4", "UA")).toEqual({ allowed: true, remaining: 2, resetAt: null });
    const k = await key();
    expect(upstash.limitImpl).toHaveBeenCalledWith("askarthur:burst", k);
    expect(upstash.limitImpl).toHaveBeenCalledWith("askarthur:daily", k);
  });

  it("empty user agent hashes as 'unknown'", async () => {
    upstash.limitImpl.mockResolvedValue({ success: true, remaining: 2, reset: RESET });
    await rl.checkRateLimit("1.2.3.4", "");
    expect(upstash.limitImpl).toHaveBeenCalledWith("askarthur:burst", await hashIdentifier("1.2.3.4", "unknown"));
  });

  it("burst exceeded → burst message, daily not consulted", async () => {
    upstash.limitImpl.mockResolvedValue({ success: false, remaining: 0, reset: RESET });
    expect(await rl.checkRateLimit("1.2.3.4", "UA")).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: new Date(RESET),
      message: "You've checked a few messages already — come back in a bit! The limit resets every hour.",
    });
    expect(upstash.limitImpl).toHaveBeenCalledTimes(1);
  });

  it("daily exceeded → daily message", async () => {
    upstash.limitImpl.mockImplementation(async (prefix) =>
      prefix === "askarthur:burst"
        ? { success: true, remaining: 2, reset: RESET }
        : { success: false, remaining: 0, reset: RESET },
    );
    expect(await rl.checkRateLimit("1.2.3.4", "UA")).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: new Date(RESET),
      message:
        "You've reached today's limit of 10 checks. Come back tomorrow for more — we want to keep this free for everyone!",
    });
  });

  it("store threw / no URL → store_unavailable per fail mode", async () => {
    upstash.limitImpl.mockRejectedValue(new Error("boom"));
    expect(await rl.checkRateLimit("1.2.3.4", "UA", "open")).toMatchObject({ allowed: true, reason: "store_unavailable" });
    expect(await rl.checkRateLimit("1.2.3.4", "UA", "closed")).toMatchObject({ allowed: false, reason: "store_unavailable" });
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await rl.checkRateLimit("1.2.3.4", "UA")).toMatchObject({ allowed: false, reason: "store_unavailable" });
  });
});

it("every exported check* function is covered by this pin", () => {
  const exported = Object.keys(rl).filter((k) => /^check[A-Z]/.test(k)).sort();
  const covered = new Set([...CASES.map((c) => c.name.split(":")[0]), "checkRateLimit"]);
  expect(exported.filter((k) => !covered.has(k))).toEqual([]);
});
