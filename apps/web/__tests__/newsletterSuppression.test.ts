import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), upsert: vi.fn(), rpc: vi.fn(), verify: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/unsubscribe", () => ({ verifyUnsubscribeToken: mocks.verify }));
import { POST as webhook } from "../app/api/webhooks/resend/route";
import { POST as unsubscribe } from "../app/api/unsubscribe-one-click/route";

const secret = "whsec_" + Buffer.from("test-signing-key").toString("base64");
function request(type = "email.complained") {
  const body = JSON.stringify({ type, data: { to: [" Reader@Example.com "] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`evt_test.${timestamp}.${body}`).digest("base64");
  return new NextRequest("https://askarthur.au/api/webhooks/resend", {
    method: "POST", body, headers: { "svix-id": "evt_test", "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
  mocks.client.mockReturnValue({ from: () => ({ upsert: mocks.upsert }), rpc: mocks.rpc });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.verify.mockReturnValue(true);
});

describe("durable newsletter suppression", () => {
  it("upgrades an existing suppression to complaint and invalidates pending subscriptions", async () => {
    expect((await webhook(request())).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith({ email: "reader@example.com", source: "resend_complaint" }, { onConflict: "email" });
    expect(mocks.rpc).toHaveBeenCalledWith("unsubscribe_newsletter", { p_email: "reader@example.com" });
  });
  it("asks the provider to retry when suppression storage fails", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "unavailable" } });
    expect((await webhook(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("asks the provider to retry when subscriber invalidation fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "unavailable" } });
    expect((await webhook(request("email.bounced"))).status).toBe(503);
  });
  it("does not acknowledge one-click unsubscribe when storage is unavailable", async () => {
    mocks.client.mockReturnValue(null);
    const response = await unsubscribe(new NextRequest("https://askarthur.au/api/unsubscribe-one-click?email=reader%40example.com&token=test", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
  it("keeps invalid one-click tokens non-disclosing without touching storage", async () => {
    mocks.verify.mockReturnValue(false);
    const response = await unsubscribe(new NextRequest("https://askarthur.au/api/unsubscribe-one-click?email=reader%40example.com&token=invalid", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
