import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ evidence: vi.fn(), cost: vi.fn() }));
vi.mock("@/lib/newsletter/evidence", () => ({ checkNewsletterEvidence: mocks.evidence }));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.cost, PRICING: { RESEND_USD_PER_EMAIL: 0.001 } }));
import { sendNewsletterBatch, sendNewsletterTest, UNSUBSCRIBE_MARKER } from "@/lib/newsletter/delivery";
const content = { subject: "Saved subject", preheader: "Saved preview", stories: [{ id: "take:1", title: "A useful warning", summary: "A reported incident.", take: "Check independently.", tells: ["Unexpected contact"], action: "Pause and check.", sourceUrl: "https://askarthur.au/scam-feed/1", sourceLabel: "Arthur", sourceDate: "2026-09-03T10:00:00Z", jurisdiction: "Unknown" }] };
function client() {
  const updates: unknown[] = [];
  const issue = { content, rendered_html: `<a href="${UNSUBSCRIBE_MARKER}">Unsubscribe</a>`, rendered_text: UNSUBSCRIBE_MARKER, sender: "Arthur <test@example.test>" };
  const rpc = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: [{ subscriber_id: 1, email: "reader@example.test" }] }).mockResolvedValue({ data: [] });
  const sb = { rpc, from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q, single: async () => ({ data: issue }), update: (value: unknown) => { updates.push({ table, value }); return q; }, then: (resolve: (x: unknown) => void) => Promise.resolve({ error: null, count: 0 }).then(resolve) }; return q;
  } };
  return { sb: sb as unknown as Parameters<typeof sendNewsletterBatch>[0], rpc, updates };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("NEWSLETTER_SEND_ENABLED", "true"); vi.stubEnv("RESEND_API_KEY", "test"); vi.stubEnv("UNSUBSCRIBE_SECRET", "test"); mocks.evidence.mockResolvedValue(undefined); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "provider-1" }) })); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("cannot send from preview even with a key", async () => { vi.stubEnv("VERCEL_ENV", "preview"); const { sb, rpc } = client(); await expect(sendNewsletterBatch(sb, "id", 1)).rejects.toThrow("disabled"); expect(rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });
it("holds unapproved issues before any provider call", async () => { const { sb, rpc } = client(); rpc.mockReset().mockResolvedValue({ error: {} }); await expect(sendNewsletterBatch(sb, "id", 1)).rejects.toThrow("not_ready"); expect(fetch).not.toHaveBeenCalled(); });
it("records only a provider-accepted frozen issue with a stable recipient key", async () => {
  const { sb, updates } = client(); await sendNewsletterBatch(sb, "issue-1", 2);
  expect(fetch).toHaveBeenCalledOnce(); const init = vi.mocked(fetch).mock.calls[0][1]!;
  expect(init.headers).toMatchObject({ "Idempotency-Key": "newsletter/issue-1/1" });
  const body = JSON.parse(init.body as string); expect(body.subject).toBe("Saved subject"); expect(body.html).not.toContain("NEWSLETTER_RECIPIENT_TOKEN"); expect(body.text).toContain("token=");
  expect(updates).toContainEqual({ table: "newsletter_deliveries", value: { status: "accepted", provider_id: "provider-1" } });
});
it("does not reset an ambiguous attempt to pending", async () => { vi.mocked(fetch).mockRejectedValue(new Error("timeout")); const { sb, updates } = client(); await expect(sendNewsletterBatch(sb, "id", 1)).rejects.toThrow("timeout"); expect(updates).toEqual([]); expect(mocks.cost).not.toHaveBeenCalled(); });
it("skips a suppressed claim without calling the provider", async () => { const { sb, rpc } = client(); rpc.mockReset().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: [{ subscriber_id: 1, email: null }] }).mockResolvedValue({ data: [] }); await sendNewsletterBatch(sb, "id", 1); expect(fetch).not.toHaveBeenCalled(); });
it("stops if a previously public source is withdrawn", async () => { mocks.evidence.mockRejectedValue(new Error("evidence_no_longer_eligible")); const { sb, rpc } = client(); await expect(sendNewsletterBatch(sb, "id", 1)).rejects.toThrow("eligible"); expect(rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });

it("sends a controlled test only to the configured operator", async () => {
  vi.stubEnv("ADMIN_TEST_EMAIL", "operator@example.test");
  const { sb, rpc, updates } = client(); rpc.mockReset().mockResolvedValue({ data: true });
  await sendNewsletterTest(sb, "issue-1", 2);
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.to).toEqual(["operator@example.test"]); expect(body.subject).toBe("[TEST] Saved subject");
  expect(updates).toContainEqual({ table: "newsletter_test_sends", value: { provider_id: "provider-1" } });
});
it("does not repeat an already attempted test", async () => {
  const { sb, rpc } = client(); rpc.mockReset().mockResolvedValue({ data: false });
  await expect(sendNewsletterTest(sb, "id", 1)).rejects.toThrow("already_attempted"); expect(fetch).not.toHaveBeenCalled();
});
it("test sends also remain disabled on preview", async () => {
  vi.stubEnv("VERCEL_ENV", "preview"); const { sb, rpc } = client();
  await expect(sendNewsletterTest(sb, "id", 1)).rejects.toThrow("disabled"); expect(rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
