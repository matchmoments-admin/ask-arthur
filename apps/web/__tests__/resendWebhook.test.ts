import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySvix } from "../app/api/webhooks/resend/route";

// Build a valid Svix signature the way Resend/Svix does, then assert verify.
function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${sig}`;
}

describe("Resend webhook Svix signature verification", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key-material").toString("base64");
  const id = "msg_123";
  const ts = "1718000000";
  const body = JSON.stringify({ type: "email.bounced", data: { to: ["x@y.com"] } });

  it("accepts a correctly-signed payload", () => {
    expect(verifySvix(secret, id, ts, body, sign(secret, id, ts, body))).toBe(true);
  });

  it("accepts when the header carries multiple space-separated signatures", () => {
    const good = sign(secret, id, ts, body);
    expect(verifySvix(secret, id, ts, body, `v1,deadbeef ${good}`)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const good = sign(secret, id, ts, body);
    expect(verifySvix(secret, id, ts, body + "x", good)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const other = "whsec_" + Buffer.from("different-key").toString("base64");
    expect(verifySvix(other, id, ts, body, sign(secret, id, ts, body))).toBe(false);
  });
});
