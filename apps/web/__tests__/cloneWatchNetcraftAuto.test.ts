import { describe, expect, it } from "vitest";

import {
  buildNetcraftBulkBody,
  type NetcraftAutoCandidate,
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
