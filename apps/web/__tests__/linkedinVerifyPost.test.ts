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
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG });
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
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/lifecycleState is DRAFT/);
  });

  it("flags a document still processing — the dead-carousel case", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: healthyPost,
      doc: { status: "PROCESSING" },
      listing: { elements: [{ id: POST }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/document status is PROCESSING/);
  });

  it("flags a post missing from the org's own listing", async () => {
    vi.stubGlobal("fetch", mockFetch({
      post: healthyPost,
      doc: { status: "AVAILABLE" },
      listing: { elements: [{ id: "urn:li:ugcPost:999" }] },
    }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/absent from the org's own recent-post listing/);
  });

  it("flags a post that can't be read back at all", async () => {
    vi.stubGlobal("fetch", mockFetch({ postStatus: 404 }));
    const v = await verifyPost({ postUrn: POST, accessToken: "t", authorUrn: ORG });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/not readable back \(HTTP 404\)/);
  });
});
