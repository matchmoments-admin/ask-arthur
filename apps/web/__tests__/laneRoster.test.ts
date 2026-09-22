import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LANES } from "@askarthur/scam-engine/lane-outcome";

import { ABSENCE_WATCHES, LANE_SHAPES } from "@/lib/laneHealth";

/**
 * Lane roster coverage — the fitness function for ADR-0025.
 *
 * On 2026-09-22 only 8 of 23 clone-watch functions wrote an Outcome Row, two
 * roster keys were not real Inngest ids, and enrich-attribution produced
 * nothing for six days with no row to say so. This test makes "not watched"
 * a recorded decision: every clone-watch function is in the roster, in an
 * absence watch, or in EXEMPT with the reason — and every roster key names a
 * function that exists.
 */

const ROOT = join(process.cwd(), "../..");
const SOURCES = [
  join(ROOT, "apps/web/app/api/inngest/functions"),
  join(ROOT, "packages/scam-engine/src/inngest"),
];
const CLONE_WATCH_ID = /^(shopfront-clone-|clone-watch-|shopfront-nrd-|report-brand-stewardship$)/;

/** Deliberately unwatched, each with the reason. Removing a reason is a decision. */
const EXEMPT: Record<string, string> = {
  "shopfront-clone-urlscan-scan-one": "operator-triggered single scan; no schedule to be absent from",
  "shopfront-clone-notify-brand": "one event per triaged alert; failures surface as fn.error (withAxiomLogging)",
  "shopfront-clone-notify-weaponised":
    "one event per weaponisation; delivery is watched by urlscan-retrieve's unnotified_weaponised",
  "shopfront-clone-enforcement-plan": "event per weaponisation behind FF_CLONE_ENFORCEMENT (off); deepening PR 6",
  "shopfront-clone-enforcement-execute": "rewired onto onward_report_log in deepening PR 6, which adds its row",
  "clone-watch-internal-digest": "monthly; lands with the monthly brand store (deepening PR 7)",
  "clone-watch-report-summary": "monthly; lands with the monthly brand store (deepening PR 7)",
  "report-brand-stewardship": "monthly; lands with the monthly brand store (deepening PR 7)",
};

function functionIds(): string[] {
  const ids: string[] = [];
  const re = /createFunction\(\s*\{\s*id:\s*"([^"]+)"/g;
  for (const dir of SOURCES) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(re)) ids.push(m[1]);
    }
  }
  return ids;
}

describe("clone-watch lane roster", () => {
  const all = functionIds();
  const cloneWatch = all.filter((id) => CLONE_WATCH_ID.test(id));

  it("finds the clone-watch functions (floor, so an empty scan cannot pass)", () => {
    expect(cloneWatch.length).toBeGreaterThanOrEqual(20);
  });

  it("every roster key names a real Inngest function (sub-lanes: <fnId>/<sub>)", () => {
    for (const key of Object.keys(LANES)) {
      expect(all, `roster key ${key}`).toContain(key.split("/")[0]);
    }
  });

  it("every roster lane has a health shape and vice versa", () => {
    expect(Object.keys(LANE_SHAPES).sort()).toEqual(Object.keys(LANES).sort());
  });

  it("every clone-watch function is watched or exempt with a reason", () => {
    const watched = new Set([
      ...Object.keys(LANES).map((k) => k.split("/")[0]),
      ...ABSENCE_WATCHES.map((w) => w.lane),
    ]);
    const unaccounted = cloneWatch.filter((id) => !watched.has(id) && !EXEMPT[id]);
    expect(unaccounted).toEqual([]);
  });

  it("no function is both watched and exempt, and no exemption is stale", () => {
    for (const id of Object.keys(EXEMPT)) {
      expect(all, `exempt ${id} no longer exists`).toContain(id);
      expect(Object.keys(LANES).map((k) => k.split("/")[0])).not.toContain(id);
    }
  });

  it("no two roster lanes share a (feature, operation) row key", () => {
    const keys = Object.values(LANES).map((l) => `${l.feature}/${l.operation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
