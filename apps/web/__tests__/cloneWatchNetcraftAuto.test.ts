import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNetcraftBulkBody,
  buildNetcraftResubmitBody,
  postNetcraftBulk,
  type NetcraftAutoCandidate,
  type NetcraftResubmitCandidate,
} from "@/app/api/inngest/functions/clone-watch-netcraft-auto";

function candidate(o: Partial<NetcraftAutoCandidate> = {}): NetcraftAutoCandidate {
  return {
    id: 501,
    candidate_url: "https://qantasw.shop/login",
    candidate_domain: "qantasw.shop",
    inferred_target_domain: "qantas.com.au",
    severity_tier: "low",
    signals: [{ signal_type: "lexical", score: 0.82 }],
    ...o,
  };
}

describe("buildNetcraftBulkBody", () => {
  it("submits ALL candidate urls in ONE bulk body (no per-candidate fan-out)", () => {
    const body = buildNetcraftBulkBody(
      [
        candidate({ id: 1, candidate_url: "https://a.test/x" }),
        candidate({ id: 2, candidate_url: "https://b.test/y" }),
        candidate({ id: 3, candidate_url: "https://c.test/z" }),
      ],
      "brendan@askarthur.au",
    );
    expect(body.email).toBe("brendan@askarthur.au");
    expect(body.urls).toEqual([
      { url: "https://a.test/x", country: "AU" },
      { url: "https://b.test/y", country: "AU" },
      { url: "https://c.test/z", country: "AU" },
    ]);
    expect(body.reason).toMatch(/clone-watch/i);
  });

  it("dedupes repeated candidate_urls in one batch", () => {
    const body = buildNetcraftBulkBody(
      [
        candidate({ id: 1, candidate_url: "https://dup.test/x" }),
        candidate({ id: 2, candidate_url: "https://dup.test/x" }),
      ],
      "brendan@askarthur.au",
    );
    expect(body.urls).toHaveLength(1);
  });

  it("skips empty candidate_urls", () => {
    const body = buildNetcraftBulkBody(
      [candidate({ id: 1, candidate_url: "" }), candidate({ id: 2 })],
      "brendan@askarthur.au",
    );
    expect(body.urls).toEqual([
      { url: "https://qantasw.shop/login", country: "AU" },
    ]);
  });

  it("produces an empty url list for no candidates", () => {
    const body = buildNetcraftBulkBody([], "brendan@askarthur.au");
    expect(body.urls).toEqual([]);
  });
});

// v250 — the resubmit lane re-approaches Netcraft about URLs they may already
// have seen, so the reason text is the thing standing between us and being
// treated as a spam reporter. It has to say what changed and let a human
// verify it, not just assert.
describe("buildNetcraftResubmitBody", () => {
  function resub(
    o: Partial<NetcraftResubmitCandidate> = {},
  ): NetcraftResubmitCandidate {
    return {
      id: 901,
      candidate_url: "https://auspost-redelivery.shop/track",
      candidate_domain: "auspost-redelivery.shop",
      inferred_target_domain: "auspost.com.au",
      urlscan_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      weaponised_at: "2026-07-20T12:00:00.000Z",
      ...o,
    };
  }

  it("cites a verifiable urlscan result per candidate, with the brand it impersonates", () => {
    const body = buildNetcraftResubmitBody([resub()], "brendan@askarthur.au");
    expect(body.reason).toContain(
      "https://urlscan.io/result/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/",
    );
    expect(body.reason).toContain("auspost-redelivery.shop");
    expect(body.reason).toContain("auspost.com.au");
  });

  it("states WHY this is a fresh report rather than a duplicate", () => {
    const body = buildNetcraftResubmitBody([resub()], "brendan@askarthur.au");
    expect(body.reason).toMatch(/no current Netcraft submission covers them/i);
    expect(body.reason).toMatch(/observed serving/i);
  });

  it("is distinguishable from the routine auto-report reason", () => {
    const auto = buildNetcraftBulkBody([candidate()], "brendan@askarthur.au");
    const resubmit = buildNetcraftResubmitBody([resub()], "brendan@askarthur.au");
    expect(resubmit.reason).not.toBe(auto.reason);
    // The auto lane asks for classification; this one reports confirmed phishing.
    expect(resubmit.reason).toMatch(/Confirmed phishing/i);
  });

  it("caps the evidence block so a full batch cannot bloat the reason field", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      resub({
        id: i,
        candidate_url: `https://c${i}.test/`,
        candidate_domain: `c${i}.test`,
        urlscan_uuid: `uuid-${i}`,
      }),
    );
    const body = buildNetcraftResubmitBody(many, "brendan@askarthur.au");
    expect(body.urls).toHaveLength(25); // every URL is still reported
    expect(body.reason.match(/urlscan\.io\/result\//g)).toHaveLength(10);
  });

  it("degrades honestly when no scan reference is available", () => {
    const body = buildNetcraftResubmitBody(
      [resub({ urlscan_uuid: null })],
      "brendan@askarthur.au",
    );
    expect(body.reason).toContain("(scan references unavailable)");
  });

  it("dedupes repeated urls and skips empty ones", () => {
    const body = buildNetcraftResubmitBody(
      [
        resub({ id: 1, candidate_url: "https://dup.test/" }),
        resub({ id: 2, candidate_url: "https://dup.test/" }),
        resub({ id: 3, candidate_url: "" }),
      ],
      "brendan@askarthur.au",
    );
    expect(body.urls).toEqual([{ url: "https://dup.test/", country: "AU" }]);
  });
});

/**
 * Both lanes POST through one helper, so "which endpoint does test mode hit"
 * is one decision with one test. Before this, each lane carried its own copy of
 * the ternary — and the resubmit lane's copy was unreachable, because the lane
 * returned on `isTest` several guards earlier.
 */
describe("postNetcraftBulk", () => {
  const BODY = {
    email: "brendan@askarthur.au",
    reason: "r",
    urls: [{ url: "https://a.test/", country: "AU" }],
  };

  function mockFetch(res: { status: number; body: string }) {
    const spy = vi.fn().mockResolvedValue({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: () => Promise.resolve(res.body),
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes test mode to the validation-only endpoint, never the live intake", async () => {
    const spy = mockFetch({ status: 200, body: '{"state":"validated"}' });
    await postNetcraftBulk(BODY, { test: true });
    const url = spy.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://report.netcraft.com/api/v3/test/report/urls");
    expect(url).toContain("/test/");
  });

  it("routes a real run to the live intake", async () => {
    const spy = mockFetch({ status: 200, body: '{"uuid":"u-1","state":"processing"}' });
    const result = await postNetcraftBulk(BODY, { test: false });
    expect(spy.mock.calls[0]?.[0]).toBe(
      "https://report.netcraft.com/api/v3/report/urls",
    );
    expect(result).toMatchObject({ ok: true, uuid: "u-1", state: "processing", urlCount: 1 });
  });

  it("surfaces a non-2xx as data rather than throwing (soft-fail contract)", async () => {
    mockFetch({ status: 429, body: "rate limited" });
    const result = await postNetcraftBulk(BODY, { test: false });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.errText).toBe("rate limited");
    expect(result.uuid).toBeNull();
  });

  it("does not throw on an unparseable body", async () => {
    mockFetch({ status: 200, body: "<html>maintenance</html>" });
    const result = await postNetcraftBulk(BODY, { test: false });
    expect(result.uuid).toBeNull();
    expect(result.raw).toEqual({ raw: "<html>maintenance</html>" });
  });
});
