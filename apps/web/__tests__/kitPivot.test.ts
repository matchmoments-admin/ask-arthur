import { describe, expect, it } from "vitest";
import { shapeKitSiblings } from "@/lib/clone-watch/kit-pivot";

const AT = new Date("2026-07-17T00:00:00.000Z");

describe("shapeKitSiblings", () => {
  it("dedups, excludes self, caps at 20, preserves last_seen", () => {
    const hits = [
      { domain: "nab-login.shop", url: "https://nab-login.shop/", lastSeen: "2026-07-16T00:00:00Z" }, // self
      { domain: "nab-secure.shop", url: null, lastSeen: "2026-07-15T00:00:00Z" },
      { domain: "NAB-SECURE.shop", url: null, lastSeen: "2026-07-14T00:00:00Z" }, // dup (case)
      { domain: "westpac-login.shop", url: null, lastSeen: null },
    ];
    const b = shapeKitSiblings("nab-login.shop", "203.0.113.7", hits, AT);
    expect(b.pivot).toBe("ip");
    expect(b.pivot_value).toBe("203.0.113.7");
    expect(b.siblings.map((s) => s.domain)).toEqual([
      "nab-secure.shop",
      "westpac-login.shop",
    ]);
    expect(b.result_count).toBe(4);
    expect(b.searched_at).toBe(AT.toISOString());
  });

  it("ALWAYS returns a block even with zero siblings (predicate-crossing rule)", () => {
    const b = shapeKitSiblings("nab-login.shop", "203.0.113.7", [], AT);
    expect(b.siblings).toEqual([]);
    expect(b.result_count).toBe(0);
    // A block is written so the row leaves the kit_siblings-IS-NULL worklist.
    expect(b.pivot_value).toBe("203.0.113.7");
  });

  it("caps siblings at 20", () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({
      domain: `sib${i}.shop`,
      url: null,
      lastSeen: null,
    }));
    const b = shapeKitSiblings("self.shop", "1.1.1.1", hits, AT);
    expect(b.siblings.length).toBe(20);
    expect(b.result_count).toBe(30);
  });
});
