import { describe, it, expect, afterEach } from "vitest";

import {
  assignPostsToThemes,
  resolveClusterThreshold,
} from "../reddit-intel-cluster";

// Build a unit vector in `dim` dimensions pointing mostly along axis `axis`
// with a little spread, so cosine similarity is controllable in a test.
function vec(dim: number, axis: number, jitter = 0): number[] {
  const v: number[] = new Array(dim)
    .fill(0)
    .map((_, i) => (i === axis ? 1 : 0));
  if (jitter) v[(axis + 1) % dim] = jitter;
  return v;
}

function post(id: string, embedding: number[]) {
  return { id, embedding, embeddingModelVersion: "voyage-3.5" };
}

const DIM = 8;

describe("assignPostsToThemes — anti-runaway guards", () => {
  it("reproduces the collapse WITHOUT the guards (control): a drifted mega-centroid absorbs everything", () => {
    // A theme whose centroid has drifted toward the global mean (all axes
    // roughly equal) scores > 0.62 against almost anything. With the ceiling
    // disabled and freeze disabled, every distinct post is swallowed.
    const driftedCentroid = new Array(DIM).fill(1 / Math.sqrt(DIM));
    const themes = [
      { id: "mega", centroid: driftedCentroid, memberCount: 2263 },
    ];

    // Posts spread across different axes — semantically distinct.
    const posts = Array.from({ length: 12 }, (_, i) =>
      post(`p${i}`, vec(DIM, i % DIM)),
    );

    const { assignments } = assignPostsToThemes(posts, themes, {
      joinCeiling: Number.POSITIVE_INFINITY, // guard OFF
      freezeAt: Number.POSITIVE_INFINITY, // guard OFF
      threshold: 0.34, // a drifted centroid at ~0.35 sim to each axis vector
    });

    const joinedMega = assignments.filter(
      (a) => !a.isNewTheme && a.themeId === "mega",
    ).length;
    // Control: with guards off the mega theme eats (nearly) all posts.
    expect(joinedMega).toBeGreaterThanOrEqual(10);
    expect(assignments.filter((a) => a.isNewTheme).length).toBeLessThanOrEqual(
      2,
    );
  });

  it("join ceiling stops an over-large theme from absorbing → posts re-seed", () => {
    const driftedCentroid = new Array(DIM).fill(1 / Math.sqrt(DIM));
    const themes = [
      { id: "mega", centroid: driftedCentroid, memberCount: 2263 },
    ];
    const posts = Array.from({ length: 12 }, (_, i) =>
      post(`p${i}`, vec(DIM, i % DIM)),
    );

    const { assignments, oversizedThemeCount } = assignPostsToThemes(
      posts,
      themes,
      { joinCeiling: 250, threshold: 0.34 },
    );

    // The 2263-member theme is over the ceiling → skipped as a target.
    expect(oversizedThemeCount).toBe(1);
    expect(
      assignments.filter((a) => !a.isNewTheme && a.themeId === "mega").length,
    ).toBe(0);
    // Every post re-seeds instead of being swallowed.
    expect(assignments.every((a) => a.isNewTheme)).toBe(true);
  });

  it("centroid freeze prevents drift: a healthy theme keeps its identity", () => {
    // A tight theme on axis 0, already at the freeze threshold. Feed it many
    // near-identical posts, then an off-axis post. With freeze ON the centroid
    // never drifts, so the off-axis post does NOT match and correctly re-seeds.
    const themes = [{ id: "t0", centroid: vec(DIM, 0), memberCount: 50 }];

    const onAxis = Array.from({ length: 5 }, (_, i) =>
      post(`on${i}`, vec(DIM, 0, 0.02)),
    );
    const offAxis = [post("off", vec(DIM, 3))];

    const { assignments } = assignPostsToThemes(
      [...onAxis, ...offAxis],
      themes,
      {
        freezeAt: 50,
        threshold: 0.62,
      },
    );

    // on-axis posts join t0; the off-axis post re-seeds (does not join).
    const off = assignments.find((a) => a.postId === "off")!;
    expect(off.isNewTheme).toBe(true);
    const onJoined = assignments.filter(
      (a) => a.postId.startsWith("on") && a.themeId === "t0",
    );
    expect(onJoined.length).toBe(5);
    // Freeze held: the centroid returned for joins equals the original axis-0
    // centroid (no drift toward the incoming jitter).
    expect(onJoined[0].newCentroid[0]).toBeCloseTo(1, 6);
    expect(onJoined[0].newCentroid[1]).toBeCloseTo(0, 6);
  });

  it("does not mutate the caller's themes array", () => {
    const centroid = vec(DIM, 0);
    const themes = [{ id: "t0", centroid, memberCount: 1 }];
    const before = JSON.stringify(themes);
    assignPostsToThemes([post("p", vec(DIM, 0, 0.01))], themes);
    expect(JSON.stringify(themes)).toBe(before);
  });

  it("still forms distinct themes for genuinely distinct posts (no over-merging)", () => {
    // No existing themes; 4 posts on 4 different axes should seed 4 themes.
    const posts = [0, 2, 4, 6].map((ax) => post(`p${ax}`, vec(DIM, ax)));
    const { assignments } = assignPostsToThemes(posts, [], { threshold: 0.62 });
    expect(assignments.every((a) => a.isNewTheme)).toBe(true);
    expect(assignments.length).toBe(4);
  });
});

describe("resolveClusterThreshold", () => {
  const KEY = "REDDIT_INTEL_CLUSTER_THRESHOLD";
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("defaults to the shipped threshold when unset", () => {
    delete process.env[KEY];
    expect(resolveClusterThreshold()).toBe(0.62);
  });

  it("honours a valid override so the value can be trialled without a deploy", () => {
    process.env[KEY] = "0.85";
    expect(resolveClusterThreshold()).toBe(0.85);
  });

  it("tolerates the trailing whitespace Vercel-stored values carry", () => {
    // The repo has been bitten by this before: a value stored as "0.85\n"
    // is not === "0.85", and Number("0.85\n") happens to work but only by
    // luck. Trim explicitly so the intent is not accidental.
    process.env[KEY] = " 0.85\n";
    expect(resolveClusterThreshold()).toBe(0.85);
  });

  it("falls back rather than trusting a typo that would disable clustering", () => {
    // "85" (meaning 85%) would make every post seed its own theme, silently
    // turning the cluster into a 1:1 post:theme map. A fallback is recoverable;
    // a corrupted theme table is not.
    for (const bad of ["85", "0", "1", "-0.8", "abc", "0.4", "0.995"]) {
      process.env[KEY] = bad;
      expect(resolveClusterThreshold(), `input ${bad}`).toBe(0.62);
    }
  });

  it("keeps the default inside the range it will accept from an override", () => {
    // Guards a future edit that lowers COSINE_THRESHOLD below the validator's
    // own floor, which would make the default unreachable via the env var.
    delete process.env[KEY];
    const def = resolveClusterThreshold();
    expect(def).toBeGreaterThan(0.5);
    expect(def).toBeLessThan(0.99);
  });
});
