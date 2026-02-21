import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import { verifyTelegramSecret, verifyWhatsAppSignature, verifySlackSignature } from "../webhook-verify";

describe("verifyTelegramSecret", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret-123");
  });

  it("returns true for valid secret", () => {
    const req = new Request("https://example.com", {
      headers: { "x-telegram-bot-api-secret-token": "test-secret-123" },
    });
    expect(verifyTelegramSecret(req)).toBe(true);
  });

  it("returns false for invalid secret", () => {
    const req = new Request("https://example.com", {
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
    });
    expect(verifyTelegramSecret(req)).toBe(false);
  });

  it("returns false when header is missing", () => {
    const req = new Request("https://example.com");
    expect(verifyTelegramSecret(req)).toBe(false);
  });

  it("returns false when env var is missing", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const req = new Request("https://example.com", {
      headers: { "x-telegram-bot-api-secret-token": "test-secret-123" },
    });
    expect(verifyTelegramSecret(req)).toBe(false);
  });
});

describe("verifyWhatsAppSignature", () => {
  const secret = "whatsapp-test-secret";
  const body = '{"entry":[]}';

  beforeEach(() => {
    vi.stubEnv("WHATSAPP_APP_SECRET", secret);
  });

  it("returns true for valid signature", async () => {
    const hmac = createHmac("sha256", secret).update(body).digest("hex");
    const req = new Request("https://example.com", {
      headers: { "x-hub-signature-256": `sha256=${hmac}` },
    });
    expect(await verifyWhatsAppSignature(req, body)).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const req = new Request("https://example.com", {
      headers: { "x-hub-signature-256": "sha256=invalid" },
    });
    expect(await verifyWhatsAppSignature(req, body)).toBe(false);
  });

  it("returns false when header is missing", async () => {
    const req = new Request("https://example.com");
    expect(await verifyWhatsAppSignature(req, body)).toBe(false);
  });
});

describe("verifySlackSignature", () => {
  const secret = "slack-signing-secret";
  const body = "token=xxx&command=%2Fcheckscam&text=test";
  const timestamp = Math.floor(Date.now() / 1000).toString();

  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", secret);
  });

  it("returns true for valid signature", () => {
    const sigBasestring = `v0:${timestamp}:${body}`;
    const hmac = createHmac("sha256", secret).update(sigBasestring).digest("hex");
    const signature = `v0=${hmac}`;

    const req = new Request("https://example.com", {
      headers: {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
    });
    expect(verifySlackSignature(req, body)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const req = new Request("https://example.com", {
      headers: {
        "x-slack-signature": "v0=invalid",
        "x-slack-request-timestamp": timestamp,
      },
    });
    expect(verifySlackSignature(req, body)).toBe(false);
  });

  it("rejects requests older than 5 minutes", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const sigBasestring = `v0:${oldTimestamp}:${body}`;
    const hmac = createHmac("sha256", secret).update(sigBasestring).digest("hex");

    const req = new Request("https://example.com", {
      headers: {
        "x-slack-signature": `v0=${hmac}`,
        "x-slack-request-timestamp": oldTimestamp,
      },
    });
    expect(verifySlackSignature(req, body)).toBe(false);
  });
});
