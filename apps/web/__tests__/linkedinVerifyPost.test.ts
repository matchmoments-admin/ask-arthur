import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPost } from "@/lib/linkedin/client";

// verifyPost re-reads a published post instead of trusting the 201. The July
// 2026 edition is the reason it exists: every field below was healthy and the
// post still never rendered — so these tests pin the failure modes the API CAN
// see, and the "healthy" case documents that green ≠ visible.

const POST = "urn:li:ugcPost:123";
const ORG = "urn:li:organization:1"; // passed explicitly so the test never reads env
const DOC = "urn:li:document:abc";

function mockFetch(handlers: {
  post?: unknown;
  postStatus?: number;
  doc?: unknown;
  docStatus?: number;
  listing?: unknown;
  listingStatus?: number;
}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/documents/")) {
      return { ok: (handlers.docStatus ?? 200) < 400, status: handlers.docStatus ?? 200, json: async () => handlers.doc };
    }
    if (u.includes("q=author")) {
      return { ok: (handlers.listingStatus ?? 200) < 400, status: handlers.listingStatus ?? 200, json: async () => handlers.listing };
    }
    return { ok: (handlers.postStatus ?? 200) < 400, status: handlers.postStatus ?? 200, json: async () => handlers.post };
  });
}

const healthyPost = {
  lifecycleState: "PUBLISHED",
  visibility: "PUBLIC",
  distribution: { feedDistribution: "MAIN_FEED" },
  content: { media: { id: DOC } },
};

afterEach(() => vi.unstubAllGlobals());

describe("verifyPost", () => {
  it("passes when every observable field is healthy", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: healthyPost,
      doc: { status: "AVAILABLE" },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.inAuthorListing).toBe(true);
  });

  it("flags a post that never reached PUBLISHED", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: { ...healthyPost, lifecycleState: "DRAFT" },
      doc: { status: "AVAILABLE" },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/lifecycleState is DRAFT/);
  });

  it("flags a document still processing — the dead-carousel case", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: healthyPost,
      doc: { status: "PROCESSING" },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/document status is PROCESSING/);
  });

  it("flags a post missing from the org's own listing", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: healthyPost,
      doc: { status: "AVAILABLE" },
      listing: { elements: [{ id: "urn:li:ugcPost:999" }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/absent from the org's own recent-post listing/);
  });

  it("flags a post that can't be read back at all", async () => {
    vi.stubGlobal("fetch", mockFetch({ postStatus: 404 }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/not readable back \(HTTP 404 after 1 attempts\)/);
  });
});

describe("verifyPost read-after-write", () => {
  it("retries a 404 and succeeds once LinkedIn catches up", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/documents/")) return { ok: true, status: 200, json: async () => ({ status: "AVAILABLE" }) };
      if (u.includes("q=author")) return { ok: true, status: 200, json: async () => ({ elements: [{ id: POST }] }) };
      calls += 1;
      if (calls === 1) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => healthyPost };
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 2, retryDelayMs: 1 });
    expect(calls).toBe(2);
    expect(v.ok).toBe(true);
  });

  it("gives up after the retries and says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 1, retryDelayMs: 1 });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toMatch(/after 2 attempts/);
  });
  // --- article (link) posts ---
  // The first live link post was flagged "post has no attached document"
  // (2026-08-21) because the document assertion ran against a shape that
  // correctly has none. A verifier that cries wolf is worse than no verifier:
  // this repo has already been burned by a green check that meant nothing, and
  // a false alarm trains people to ignore the real one.

  it("does not demand a document on an article post", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: {
        lifecycleState: "PUBLISHED",
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED" },
        content: { article: { source: "https://askarthur.au/hub" } },
      },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({
      postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0, shape: "article",
    });
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("flags an article post that lost its link source", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: {
        lifecycleState: "PUBLISHED",
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED" },
        content: {},
      },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({
      postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0, shape: "article",
    });
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("article post has no link source");
  });

  it("still demands a document when the shape is document (default)", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: {
        lifecycleState: "PUBLISHED",
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED" },
        content: { article: { source: "https://askarthur.au/hub" } },
      },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG, retries: 0 });
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("post has no attached document");
  });
});
