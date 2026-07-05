import { describe, it, expect } from "vitest";
import {
  CLONE_WATCH_SPOKES,
  cloneWatchSpokeLinks,
  isCloneWatchSpoke,
} from "@/lib/clone-watch/spokes";

// Orphan-check: this test runs in the CI "Test" job and FAILS THE BUILD if the
// Clone Watch hub-and-spoke link graph breaks — an orphaned spoke (nothing
// links to it) is effectively invisible to search.

const slugs = CLONE_WATCH_SPOKES.map((s) => s.slug);
const slugSet = new Set(slugs);

describe("Clone Watch spoke manifest — orphan check", () => {
  it("has no duplicate slugs", () => {
    expect(slugSet.size).toBe(slugs.length);
  });

  it("has no dangling lateral links (every lateral references a real spoke)", () => {
    for (const spoke of CLONE_WATCH_SPOKES) {
      for (const ls of spoke.lateralSlugs) {
        expect(slugSet.has(ls), `${spoke.slug} -> ${ls} is dangling`).toBe(true);
      }
    }
  });

  it("has no self-referencing lateral links", () => {
    for (const spoke of CLONE_WATCH_SPOKES) {
      expect(spoke.lateralSlugs).not.toContain(spoke.slug);
    }
  });

  it("has NO orphan — every spoke has at least one inbound lateral link", () => {
    const referenced = new Set<string>();
    for (const spoke of CLONE_WATCH_SPOKES) {
      for (const ls of spoke.lateralSlugs) referenced.add(ls);
    }
    const orphans = slugs.filter((s) => !referenced.has(s));
    expect(orphans, `orphaned spokes: ${orphans.join(", ")}`).toEqual([]);
  });
});

describe("cloneWatchSpokeLinks", () => {
  const spoke = CLONE_WATCH_SPOKES[0];

  it("returns empty string for a non-spoke slug", () => {
    expect(cloneWatchSpokeLinks("not-a-spoke", true)).toBe("");
    expect(isCloneWatchSpoke("not-a-spoke")).toBe(false);
  });

  it("includes the pillar backlink only when includePillar is true (#371 gate)", () => {
    expect(cloneWatchSpokeLinks(spoke.slug, true)).toContain("](/clone-watch)");
    expect(cloneWatchSpokeLinks(spoke.slug, false)).not.toContain("](/clone-watch)");
  });

  it("injects lateral links to /blog/<slug> and no UTMs", () => {
    const out = cloneWatchSpokeLinks(spoke.slug, false);
    for (const ls of spoke.lateralSlugs) {
      expect(out).toContain(`](/blog/${ls})`);
    }
    expect(out).not.toContain("utm_");
  });
});
