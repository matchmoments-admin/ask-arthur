import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ admin: vi.fn(), client: vi.fn(), from: vi.fn(), claim: vi.fn(), write: vi.fn(), token: vi.fn(), post: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdmin: m.admin, getAdminUserId: async () => "operator" }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: m.client }));
vi.mock("@/lib/linkedin/client", () => ({ resolveAccessToken: m.token, createTextPost: m.post, postUrl: (id: string) => `https://www.linkedin.com/feed/update/${id}` }));
import { POST as publish } from "../app/api/admin/linkedin-drafts/publish/route";
import { POST as save } from "../app/api/admin/linkedin-drafts/route";
import { ASK_ARTHUR_ORG, plainLinkedInText } from "../lib/linkedin/drafts";
const id = "a47a0001-0000-4000-8000-000000000001";
const body = { id, version: 1, publishNow: true };
function req(data: unknown = body, origin = "https://askarthur.au") {
  return new NextRequest("https://askarthur.au/api/admin/linkedin-drafts/publish", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("LINKEDIN_STUDIO_PUBLISH_ENABLED", "true"); vi.stubEnv("LINKEDIN_ORG_URN", ASK_ARTHUR_ORG);
  const chain = { update: m.update, insert: m.insert, eq: m.eq, select: vi.fn(), maybeSingle: m.claim, then: (resolve: (value: unknown) => unknown) => Promise.resolve(m.write()).then(resolve) };
  m.update.mockReturnValue(chain); m.insert.mockReturnValue(chain); m.eq.mockReturnValue(chain); chain.select.mockReturnValue(chain);
  m.from.mockReturnValue(chain); m.client.mockReturnValue({ from: m.from });
  m.claim.mockResolvedValue({ data: { commentary: "A check (before you pay)." }, error: null });
  m.write.mockReturnValue({ error: null }); m.token.mockResolvedValue("test-token"); m.post.mockResolvedValue("urn:li:share:123");
});
describe("manual company-page publishing", () => {
  it("requires admin access before touching storage or LinkedIn", async () => {
    m.admin.mockRejectedValue(new Error("unauthorised"));
    await expect(publish(req())).rejects.toThrow("unauthorised");
    expect(m.client).not.toHaveBeenCalled(); expect(m.post).not.toHaveBeenCalled();
  });
  it("rejects cross-origin posts", async () => {
    expect((await publish(req(body, "https://elsewhere.example"))).status).toBe(403);
    expect(m.token).not.toHaveBeenCalled();
  });
  it("requires the explicit publish confirmation", async () => {
    expect((await publish(req({ id, version: 1 }))).status).toBe(400);
    expect(m.token).not.toHaveBeenCalled();
  });
  it.each([['VERCEL_ENV', 'preview'], ['LINKEDIN_STUDIO_PUBLISH_ENABLED', 'false'], ['LINKEDIN_ORG_URN', 'urn:li:person:123']])("blocks incorrect %s", async (name, value) => {
    vi.stubEnv(name, value); expect((await publish(req())).status).toBe(503); expect(m.post).not.toHaveBeenCalled();
  });
  it("leaves the draft unclaimed if credentials cannot resolve", async () => {
    m.token.mockRejectedValue(new Error("expired")); expect((await publish(req())).status).toBe(503); expect(m.update).not.toHaveBeenCalled();
  });
  it("does not send when the claim cannot be persisted", async () => {
    m.claim.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await publish(req())).status).toBe(503); expect(m.post).not.toHaveBeenCalled();
  });
  it("publishes only the claimed saved text, with its revision and company pinned", async () => {
    expect((await publish(req({ ...body, commentary: "injected", author: "other" }))).status).toBe(200);
    expect(m.eq).toHaveBeenCalledWith("version", 1); expect(m.eq).toHaveBeenCalledWith("status", "draft");
    expect(m.post).toHaveBeenCalledWith({ commentary: "A check \\(before you pay\\).", accessToken: "test-token", authorUrn: ASK_ARTHUR_ORG });
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: "published", post_urn: "urn:li:share:123" }));
  });
  it("only sends once when a repeat request loses the database claim", async () => {
    m.claim.mockResolvedValueOnce({ data: { commentary: "saved" }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const responses = await Promise.all([publish(req()), publish(req())]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect(m.post).toHaveBeenCalledTimes(1);
  });
  it("locks uncertain outcomes without retrying", async () => {
    m.post.mockRejectedValue(new Error("timeout")); expect((await publish(req())).status).toBe(502);
    expect(m.post).toHaveBeenCalledTimes(1); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: "uncertain" }));
  });
  it("returns the accepted post link when receipt storage fails, never resending", async () => {
    m.write.mockReturnValue({ error: { message: "offline" } });
    const result = await (await publish(req())).json();
    expect(result.receiptSaved).toBe(false); expect(result.url).toContain("urn:li:share:123"); expect(m.post).toHaveBeenCalledTimes(1);
  });
  it("saving a draft never calls LinkedIn", async () => {
    expect((await save(req({ title: "Draft", commentary: "Keep private" }))).status).toBe(200);
    expect(m.token).not.toHaveBeenCalled(); expect(m.post).not.toHaveBeenCalled();
  });
  it("does not overwrite a stale or already published draft", async () => {
    m.claim.mockResolvedValue({ data: null, error: null });
    expect((await save(req({ id, version: 1, title: "Draft", commentary: "changed" }))).status).toBe(409);
    expect(m.eq).toHaveBeenCalledWith("status", "draft"); expect(m.eq).toHaveBeenCalledWith("version", 1);
  });
  it("escapes LinkedIn formatting so the preview remains plain text", () => {
    expect(plainLinkedInText("[test] @x #tag *hi* \\ ok")).toBe("\\[test\\] \\@x \\#tag \\*hi\\* \\\\ ok");
  });
});
