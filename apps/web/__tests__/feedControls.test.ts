import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  deriveState,
  dispatchTargetFor,
  PROBEABLE_FEEDS,
} from "@/lib/dashboard/feed-controls";

// #952. The state machine matters because "disabled" is the one state that
// never resolves itself — acsc sat at enabled=false with no muted_until and
// nothing in the console said so.
describe("deriveState", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();

  it("disabled outranks every other signal", () => {
    expect(deriveState({ enabled: false, mutedUntil: null, hoursSinceSuccess: 1 })).toBe("disabled");
    expect(deriveState({ enabled: false, mutedUntil: future, hoursSinceSuccess: null })).toBe("disabled");
  });

  it("an in-force mute reads muted; a lapsed one does not", () => {
    expect(deriveState({ enabled: true, mutedUntil: future, hoursSinceSuccess: 999 })).toBe("muted");
    expect(deriveState({ enabled: true, mutedUntil: past, hoursSinceSuccess: 999 })).toBe("stale");
  });

  it("distinguishes never-run from stale", () => {
    expect(deriveState({ enabled: true, mutedUntil: null, hoursSinceSuccess: null })).toBe("never-run");
    expect(deriveState({ enabled: true, mutedUntil: null, hoursSinceSuccess: 40 })).toBe("stale");
    expect(deriveState({ enabled: true, mutedUntil: null, hoursSinceSuccess: 6 })).toBe("ok");
  });
});

describe("dispatchTargetFor", () => {
  it("maps feed_health names onto the workflow's input values", () => {
    expect(dispatchTargetFor("acsc")).toBe("acsc_alerts");
    expect(dispatchTargetFor("asic_investor")).toBe("asic_investor_alerts");
    expect(dispatchTargetFor("openphish")).toBe("openphish");
  });

  it("returns null when the workflow has no target (no bogus dispatch)", () => {
    expect(dispatchTargetFor("inbound_krebs")).toBeNull();
    expect(dispatchTargetFor("nvd_recent")).toBeNull();
  });
});

// Drift guard: the allow-list must match the workflow's own choice options, or
// a probe button dispatches a value the workflow rejects.
describe("PROBEABLE_FEEDS vs the workflow", () => {
  it("every declared feed is a real dispatch option", () => {
    const yml = fs.readFileSync(
      path.join(process.cwd(), "../../.github/workflows/scrape-feeds.yml"),
      "utf8",
    );
    const block = yml.slice(yml.indexOf("type: choice"), yml.indexOf("type: choice") + 1200);
    const options = new Set(
      Array.from(block.matchAll(/^\s+- (\w+)$/gm)).map((m) => m[1]),
    );
    expect(options.size).toBeGreaterThan(5); // parsed something real
    for (const feed of PROBEABLE_FEEDS) {
      expect(options.has(feed), `${feed} is not a scrape-feeds.yml choice option`).toBe(true);
    }
  });
});
