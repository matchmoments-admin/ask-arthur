import { describe, expect, it } from "vitest";

import {
  buildNetcraftBulkBody,
  buildNetcraftResubmitBody,
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
