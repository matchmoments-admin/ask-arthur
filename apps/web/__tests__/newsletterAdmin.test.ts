import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), evidence: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/newsletter/evidence", () => ({ checkNewsletterEvidence: mocks.evidence }));
vi.mock("@/lib/newsletter/delivery", () => ({ sendNewsletterBatch: mocks.send, newsletterCanSend: () => false, UNSUBSCRIBE_MARKER: "https://askarthur.au/unsubscribe/NEWSLETTER_RECIPIENT_TOKEN" }));
import { POST } from "@/app/api/admin/newsletter/route";
const id = "a47a0001-0000-4000-8000-000000000001";
const story = { id: "take:1", title: "Check an unexpected request", summary: "A reader described a suspicious request.", take: "Pressure can discourage checking.", tells: ["Pressure to hurry"], action: "Check independently.", sourceUrl: "https://askarthur.au/scam-feed/1", sourceLabel: "Arthur’s Take", sourceDate: "2026-09-03T10:00:00Z", jurisdiction: "Unknown" };
const content = { subject: "Arthur’s Watch", preheader: "This week", stories: [story] };
function req(body: object, origin = "https://askarthur.au") { return new NextRequest("https://askarthur.au/api/admin/newsletter", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
function client(data: unknown) {
  const update = vi.fn(); const query = { select: () => query, eq: () => query, in: () => query, update: (value: unknown) => { update(value); return query; }, maybeSingle: vi.fn().mockResolvedValueOnce({ data }).mockResolvedValue({ data: { id } }) };
  mocks.client.mockReturnValue({ from: () => query }); return { update, query };
}
beforeEach(() => { vi.resetAllMocks(); });
it("requires admin auth before handling a mutation", async () => { mocks.auth.mockRejectedValue(new Error("unauthorized")); await expect(POST(req({ action: "prepare" }))).rejects.toThrow("unauthorized"); expect(mocks.client).not.toHaveBeenCalled(); });
it("rejects cross-origin mutations", async () => { expect((await POST(req({ action: "prepare" }, "https://evil.test"))).status).toBe(403); expect(mocks.client).not.toHaveBeenCalled(); });
it("rejects stale revisions", async () => { client(null); expect((await POST(req({ action: "save", id, revision: 1, content }))).status).toBe(409); });
it("editing clears approval and rendered snapshots", async () => {
  const { update } = client({ content, candidates: [story] });
  expect((await POST(req({ action: "save", id, revision: 1, content }))).status).toBe(200);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, status: "draft", approved_revision: null, rendered_html: null, rendered_text: null }));
});
it("approval requires the explicit evidence review acknowledgement", async () => {
  expect((await POST(req({ action: "approve", id, revision: 1, evidenceReviewed: false }))).status).toBe(400);
  expect(mocks.client).not.toHaveBeenCalled();
});
it("freezes a reviewed revision without sending it", async () => {
  const { update } = client({ content, candidates: [story] });
  expect((await POST(req({ action: "approve", id, revision: 1, evidenceReviewed: true }))).status).toBe(200);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ approved_revision: 1, status: "approved", rendered_html: expect.stringContaining("NEWSLETTER_RECIPIENT_TOKEN"), rendered_text: expect.stringContaining("NEWSLETTER_RECIPIENT_TOKEN") }));
  expect(mocks.evidence).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled();
});
it("cannot approve incomplete regulator placeholders", async () => {
  const incomplete = { ...content, stories: [{ ...story, action: "Add the safe next step recommended by the source." }] };
  const { update } = client({ content: incomplete, candidates: [story] });
  expect((await POST(req({ action: "approve", id, revision: 1, evidenceReviewed: true }))).status).toBe(400); expect(update).not.toHaveBeenCalled();
});

it("requires an inbox-check acknowledgement before audience sending", async () => {
  expect((await POST(req({ action: "send", id, revision: 1 }))).status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});
