import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { requestNewsletterConfirmation, hashConfirmationToken } from "@/lib/newsletter-subscription";
const mocks = vi.hoisted(() => ({ cost: vi.fn() }));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.cost, PRICING: { RESEND_USD_PER_EMAIL: 0.0009 } }));
const rpc = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
  vi.stubGlobal("fetch", fetchMock);
  rpc.mockResolvedValue({ data: true, error: null });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "receipt" }), { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
// Test only the client capability consumed by this helper.
const client = { rpc } as unknown as Parameters<typeof requestNewsletterConfirmation>[0];
describe("newsletter confirmation delivery", () => {
  it("sends a fragment token while persisting only its hash", async () => {
    await requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page");
    const [url, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    const token = body.text.match(/\/subscribe\/confirm#([a-f0-9]{64})/)[1];
    expect(rpc.mock.calls[0][1].p_token_hash).toBe(hashConfirmationToken(token));
    expect(url).toBe("https://api.resend.com/emails");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.headers["Idempotency-Key"]).toBe(`newsletter-confirmation/${hashConfirmationToken(token)}`);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mocks.cost).toHaveBeenCalledWith(expect.objectContaining({ feature: "newsletter_confirmation", units: 1 }));
  });
  it("does not send for active, suppressed or cooldown recipients", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed when budget/brake/store cannot admit a send", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    await expect(requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses to create pending requests without mail configuration", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([429, 500])("propagates provider rejection %s and records no accepted send", async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "rejected" }), { status }));
    await expect(requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page")).rejects.toThrow();
    expect(mocks.cost).not.toHaveBeenCalled();
  });
  it("does not turn accepted mail into a failure if telemetry throws", async () => {
    mocks.cost.mockImplementationOnce(() => { throw new Error("telemetry"); });
    await expect(requestNewsletterConfirmation(client, "reader@example.test", "subscribe_page")).resolves.toBeUndefined();
  });
});
