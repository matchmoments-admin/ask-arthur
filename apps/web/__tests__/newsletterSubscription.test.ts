import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ create: vi.fn(), request: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: mocks.create }));
vi.mock("@askarthur/utils/rate-limit", () => ({ checkFormRateLimit: mocks.limit }));
vi.mock("@/lib/newsletter-subscription", () => ({
  requestNewsletterConfirmation: mocks.request,
  hashConfirmationToken: (s: string) => `hash:${s}`,
}));
import { POST as subscribe } from "@/app/api/subscribe/route";
import { POST as confirm } from "@/app/api/subscribe/confirm/route";
import { POST as unsubscribe } from "@/app/api/unsubscribe/route";
import { POST as waitlist } from "@/app/api/waitlist/route";
const req = (path: string, body: unknown) => new NextRequest(`https://askarthur.au/api/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "192.0.2.1" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReturnValue({ rpc: mocks.rpc });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.request.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
describe("newsletter ownership lifecycle routes", () => {
  it("fails closed when signup storage is absent", async () => {
    mocks.create.mockReturnValue(null);
    expect((await subscribe(req("subscribe", { email: "reader@example.test" }))).status).toBe(503);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("requests confirmation for a canonical address without directly activating it", async () => {
    const res = await subscribe(req("subscribe", { email: " Reader@Example.test ", source: "subscribe_page" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, status: "confirmation_required" });
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(), "reader@example.test", "subscribe_page");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not claim success after a delivery or storage failure", async () => {
    mocks.request.mockRejectedValue(new Error("provider refused"));
    expect((await subscribe(req("subscribe", { email: "reader@example.test" }))).status).toBe(503);
  });
  it("rejects malformed addresses and unrecognised sources", async () => {
    for (const body of [{ email: "bad" }, { email: "ok@example.test", source: "attacker" }]) {
      expect((await subscribe(req("subscribe", body))).status).toBe(400);
    }
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("stops before confirmation generation on rate limit", async () => {
    mocks.limit.mockResolvedValue({ allowed: false });
    expect((await subscribe(req("subscribe", { email: "reader@example.test" }))).status).toBe(429);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("only passes the token hash to the atomic confirm RPC", async () => {
    const token = "a".repeat(64);
    expect((await confirm(req("subscribe/confirm", { token }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_newsletter_subscription", { p_token_hash: `hash:${token}` });
  });
  it("rejects expired/used confirmation and does not fake storage success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: { code: "missing_rpc" } });
    expect((await confirm(req("subscribe/confirm", { token: "a".repeat(64) }))).status).toBe(400);
    expect((await confirm(req("subscribe/confirm", { token: "a".repeat(64) }))).status).toBe(503);
  });
  it("rejects malformed tokens without database work", async () => {
    expect((await confirm(req("subscribe/confirm", { token: "bad" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not claim an opt-out was saved when DB is unavailable", async () => {
    mocks.create.mockReturnValue(null);
    expect((await unsubscribe(req("unsubscribe", { email: "reader@example.test" }))).status).toBe(503);
  });
  it("routes legacy waitlist weekly opt-in through the same confirmation gate", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.create.mockReturnValue({ from: vi.fn(() => ({ upsert })) });
    expect((await waitlist(req("waitlist", { email: "Reader@example.test", subscribedWeekly: true }))).status).toBe(200);
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(), "reader@example.test", "waitlist_homepage");
    expect(upsert).toHaveBeenCalledTimes(1); // waitlist only; no subscriber upsert
  });
  it("does not send newsletter confirmation for an unchecked waitlist opt-in", async () => {
    mocks.create.mockReturnValue({ from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) })) });
    expect((await waitlist(req("waitlist", { email: "reader@example.test", subscribedWeekly: false }))).status).toBe(200);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
