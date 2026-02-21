import { describe, it, expect, vi, beforeEach } from "vitest";
import { scrubPII } from "@askarthur/scam-engine/pipeline";
import type { AnalysisResult } from "@askarthur/types";

// ── Mocks ──

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/r2", () => ({
  uploadScreenshot: vi.fn(() => Promise.resolve("screenshots/2025-01-01/abc.png")),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
const { createServiceClient } = await import("@askarthur/supabase/server");
const { uploadScreenshot } = await import("@/lib/r2");
const { logger } = await import("@askarthur/utils/logger");
const { storeVerifiedScam, storePhoneLookups } = await import("@askarthur/scam-engine/pipeline");

// ── Helpers ──

function makeAnalysis(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    verdict: "HIGH_RISK",
    confidence: 0.95,
    summary: "This is a scam message from john@evil.com",
    redFlags: ["Urgency", "Asks for 123 Main Street address"],
    nextSteps: ["Do not respond"],
    scamType: "phishing",
    impersonatedBrand: "AusPost",
    channel: "sms",
    ...overrides,
  };
}

// ── scrubPII tests ──

describe("scrubPII", () => {
  it("scrubs email addresses", () => {
    expect(scrubPII("Contact john@example.com for details")).toContain("[EMAIL]");
    expect(scrubPII("Contact john@example.com for details")).not.toContain(
      "john@example.com"
    );
  });

  it("scrubs credit card numbers (phone pattern catches segments first)", () => {
    const result = scrubPII("Card: 4111 1111 1111 1111");
    expect(result).not.toContain("4111 1111 1111 1111");
    expect(result).not.toMatch(/\d{4}\s\d{4}\s\d{4}\s\d{4}/);
  });

  it("scrubs Australian Tax File Numbers", () => {
    const result = scrubPII("TFN: 123 456 789");
    expect(result).toContain("[TFN]");
  });

  it("scrubs IP addresses", () => {
    const result = scrubPII("Your IP is 192.168.1.100");
    expect(result).toContain("[IP]");
    expect(result).not.toContain("192.168.1.100");
  });

  it("scrubs Australian mobile numbers", () => {
    const result = scrubPII("Call me on 0412 345 678");
    expect(result).not.toContain("0412 345 678");
  });

  it("scrubs names after greeting prefixes", () => {
    const result = scrubPII("Dear John Smith, your account is locked");
    expect(result).toContain("[NAME]");
    expect(result).not.toContain("John Smith");
  });

  it("scrubs street addresses", () => {
    const result = scrubPII("Send to 123 Main Street");
    expect(result).toContain("[ADDRESS]");
  });

  it("handles text with no PII", () => {
    const text = "This is a normal message with no personal info.";
    expect(scrubPII(text)).toBe(text);
  });

  it("scrubs multiple PII types in the same text", () => {
    const result = scrubPII(
      "Dear John Smith, email john@test.com or call 0412 345 678"
    );
    expect(result).toContain("[NAME]");
    expect(result).toContain("[EMAIL]");
  });

  // Pattern ordering tests — specific patterns must match before generic phone
  it("scrubs Medicare numbers as [MEDICARE], not [PHONE]", () => {
    const result = scrubPII("Medicare: 2345 67890 1");
    expect(result).toContain("[MEDICARE]");
    expect(result).not.toMatch(/\d{4}\s\d{5}\s\d/);
  });

  it("scrubs credit card numbers as [CARD], not [PHONE]", () => {
    const result = scrubPII("Card: 4111 1111 1111 1111");
    expect(result).toContain("[CARD]");
  });

  it("scrubs TFN without spaces as [TFN], not [PHONE]", () => {
    const result = scrubPII("My TFN is 987654321");
    expect(result).toContain("[TFN]");
  });

  it("scrubs Australian landline numbers", () => {
    const result = scrubPII("Call 02 9876 5432");
    expect(result).not.toContain("9876 5432");
  });

  it("scrubs BSB numbers", () => {
    const result = scrubPII("BSB: 062-000");
    expect(result).toContain("[BSB]");
    expect(result).not.toContain("062-000");
  });

  it("scrubs SSN numbers", () => {
    const result = scrubPII("SSN: 123-45-6789");
    expect(result).toContain("[SSN]");
    expect(result).not.toContain("123-45-6789");
  });
});

// ── storeVerifiedScam tests ──

describe("storeVerifiedScam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom } as any);
    vi.mocked(uploadScreenshot).mockResolvedValue("screenshots/2025-01-01/abc.png");
  });

  it("inserts into verified_scams with correct shape", async () => {
    const analysis = makeAnalysis();
    await storeVerifiedScam(analysis, "AU");

    expect(mockFrom).toHaveBeenCalledWith("verified_scams");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scam_type: "phishing",
        channel: "sms",
        region: "AU",
        confidence_score: 0.95,
        impersonated_brand: "AusPost",
      })
    );
  });

  it("applies PII scrubbing to summary and red flags before insert", async () => {
    const analysis = makeAnalysis({
      summary: "Scam sent by john@evil.com",
      redFlags: ["Visit 123 Main Street"],
    });
    await storeVerifiedScam(analysis, "AU");

    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.summary).toContain("[EMAIL]");
    expect(insertArg.summary).not.toContain("john@evil.com");
    expect(insertArg.red_flags[0]).toContain("[ADDRESS]");
    expect(insertArg.red_flags[0]).not.toContain("123 Main Street");
  });

  it("logs error when Supabase insert fails", async () => {
    mockInsert.mockResolvedValue({
      error: { message: "RLS violation", code: "42501" },
    });

    await storeVerifiedScam(makeAnalysis(), "AU");

    expect(logger.error).toHaveBeenCalledWith(
      "verified_scams insert failed",
      expect.objectContaining({
        error: "RLS violation",
        code: "42501",
      })
    );
  });

  it("calls uploadScreenshot when imageBase64 is provided and under 4MB", async () => {
    const smallImage = Buffer.from("tiny png data").toString("base64");
    await storeVerifiedScam(makeAnalysis(), "AU", smallImage);

    expect(uploadScreenshot).toHaveBeenCalledWith(
      expect.any(Buffer),
      "image/png"
    );
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.screenshot_key).toBe("screenshots/2025-01-01/abc.png");
  });

  it("skips upload when imageBase64 exceeds 4MB", async () => {
    const largeImage = Buffer.alloc(5 * 1024 * 1024).toString("base64");
    await storeVerifiedScam(makeAnalysis(), "AU", largeImage);

    expect(uploadScreenshot).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("exceeds 4MB"),
      expect.any(Object)
    );
  });

  it("detects JPEG content type from base64 header", async () => {
    const jpegImage = "/9j/" + Buffer.from("jpeg data").toString("base64");
    await storeVerifiedScam(makeAnalysis(), "AU", jpegImage);

    expect(uploadScreenshot).toHaveBeenCalledWith(
      expect.any(Buffer),
      "image/jpeg"
    );
  });

  it("no-ops gracefully when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);

    await storeVerifiedScam(makeAnalysis(), "AU");

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("defaults scam_type to 'other' when not provided", async () => {
    const analysis = makeAnalysis({ scamType: undefined });
    await storeVerifiedScam(analysis, "AU");

    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.scam_type).toBe("other");
  });
});

// ── storePhoneLookups tests ──

describe("storePhoneLookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom } as any);
  });

  it("inserts phone lookup rows with scrubbed phone numbers", async () => {
    await storePhoneLookups("analysis-123", [
      {
        phoneNumber: "+61412345678",
        countryCode: "AU",
        lineType: "mobile",
        carrier: "Telstra",
        isVoip: false,
        riskFlags: ["suspicious_carrier"],
      },
    ]);

    expect(mockFrom).toHaveBeenCalledWith("phone_lookups");
    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].phone_number_scrubbed).toBe("*********678");
    expect(rows[0].analysis_id).toBe("analysis-123");
  });

  it("logs error when insert fails", async () => {
    mockInsert.mockResolvedValue({
      error: { message: "constraint violation", code: "23505" },
    });

    await storePhoneLookups("analysis-123", [
      {
        phoneNumber: "+61412345678",
        countryCode: "AU",
        lineType: "mobile",
        carrier: "Telstra",
        isVoip: false,
        riskFlags: [],
      },
    ]);

    expect(logger.error).toHaveBeenCalledWith(
      "phone_lookups insert failed",
      expect.objectContaining({
        error: "constraint violation",
        code: "23505",
      })
    );
  });

  it("no-ops when lookups array is empty", async () => {
    await storePhoneLookups("analysis-123", []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("no-ops when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);

    await storePhoneLookups("analysis-123", [
      {
        phoneNumber: "+61412345678",
        countryCode: "AU",
        lineType: "mobile",
        carrier: "Telstra",
        isVoip: false,
        riskFlags: [],
      },
    ]);

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
