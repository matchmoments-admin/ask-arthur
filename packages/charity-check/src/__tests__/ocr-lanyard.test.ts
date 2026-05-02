import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We test the parseExtraction logic indirectly via ocrLanyard's behaviour
// when we mock the Anthropic SDK. The actual Claude Vision API call is
// out of scope for unit tests (covered by manual smoke-testing on
// preview deploys per the ops runbook).
//
// vi.hoisted is required so `createMock` is defined when vi.mock's
// factory runs (the factory is hoisted to before normal imports). Without
// hoisted, `createMock` would be undefined at factory-evaluation time.

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  // ocrLanyard does `new Anthropic()`. vi.fn().mockImplementation() returns
  // an arrow function which can't be `new`'d, so use a real class instead.
  class MockAnthropic {
    messages = { create: createMock };
  }
  return { default: MockAnthropic };
});

import { ocrLanyard } from "../ocr-lanyard";

describe("ocrLanyard", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns extracted=false when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await ocrLanyard("base64data", "image/jpeg");
    expect(out.extracted).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("parses JSON output into structured fields", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            charity_name: "Australian Red Cross",
            abn: "11005357522",
            badge_number: "RC-1234",
          }),
        },
      ],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.extracted).toBe(true);
    expect(out.charity_name).toBe("Australian Red Cross");
    expect(out.abn).toBe("11005357522");
    expect(out.badge_number).toBe("RC-1234");
  });

  it("strips markdown fences if Claude wraps despite instructions", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '```json\n{"charity_name":"Cancer Council Australia"}\n```',
        },
      ],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.extracted).toBe(true);
    expect(out.charity_name).toBe("Cancer Council Australia");
  });

  it("rejects non-11-digit ABNs (model misread)", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ abn: "12345" }) }],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.abn).toBeUndefined();
    expect(out.extracted).toBe(false); // no other fields → no extraction
  });

  it("strips spaces/dashes from valid ABN", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ abn: "11 005 357 522" }) }],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.abn).toBe("11005357522");
  });

  it("returns extracted=false on garbage Claude output", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I cannot read this image" }],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.extracted).toBe(false);
  });

  it("returns extracted=false on empty object (model said {})", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.extracted).toBe(false);
  });

  it("never throws — returns extracted=false on Claude API error", async () => {
    createMock.mockRejectedValue(new Error("network down"));
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.extracted).toBe(false);
  });

  it("ignores non-string fields (model returned wrong types)", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            charity_name: "Real Charity",
            abn: 11005357522, // returned as number, not string
          }),
        },
      ],
    });
    const out = await ocrLanyard("data", "image/jpeg");
    expect(out.charity_name).toBe("Real Charity");
    expect(out.abn).toBeUndefined();
    expect(out.extracted).toBe(true); // charity_name is enough
  });
});
