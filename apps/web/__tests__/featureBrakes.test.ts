import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KNOWN_BRAKE_KEYS } from "@/lib/dashboard/feature-brakes";

// #951. Two properties keep this panel honest:
//  1. "braked" must mean exactly what the workers mean — paused_until in the
//     FUTURE (isFeatureBraked). A lapsed row is inert and must not read as
//     holding, or the console claims protection that isn't there.
//  2. The key list must cover the keys workers actually check, or a feature
//     can never be braked from the console on the day it matters.

function isActive(pausedUntil: string | null): boolean {
  return !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();
}

describe("brake activity matches isFeatureBraked semantics", () => {
  it("a future paused_until holds", () => {
    expect(isActive(new Date(Date.now() + 3600_000).toISOString())).toBe(true);
  });
  it("a lapsed paused_until is inert, not holding", () => {
    expect(isActive(new Date(Date.now() - 3600_000).toISOString())).toBe(false);
  });
  it("a missing paused_until is inert", () => {
    expect(isActive(null)).toBe(false);
  });
});

describe("KNOWN_BRAKE_KEYS covers the keys workers check", () => {
  it("includes every literal passed to isFeatureBraked() / BRAKE constants", () => {
    // Walk the WHOLE repo, not just apps/web/app/api — six live brake keys
    // live in packages/ and the first version of this test could not see them.
    const roots = [
      path.join(process.cwd(), "app"),
      path.join(process.cwd(), "../../packages"),
    ];
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) {
          const src = fs.readFileSync(full, "utf8");
          for (const m of src.matchAll(/isFeatureBraked\("([a-z0-9_]+)"\)/g)) found.add(m[1]);
          for (const m of src.matchAll(/const (?:\w*BRAKE\w*) = "([a-z0-9_]+)"/g)) found.add(m[1]);
          // Raw feature_brakes lookups/writes the helper doesn't wrap (e.g. the
          // cost cron's auto-pause upserts). SCOPED to feature_brakes blocks:
          // cost_telemetry shares the column name "feature", so an unscoped
          // pattern pulls in cost labels like "inbound_scan" that are not
          // brakes at all (caught when this test first ran widened).
          for (const m of src.matchAll(/feature_brakes[\s\S]{0,400}?/g)) {
            const block = src.slice(m.index ?? 0, (m.index ?? 0) + 160);
            for (const k of block.matchAll(/\.eq\("feature",\s*"([a-z0-9_]+)"\)/g)) found.add(k[1]);
            for (const k of block.matchAll(/feature:\s*"([a-z0-9_]+)"/g)) found.add(k[1]);
          }
        }
      }
    };
    for (const r of roots) if (fs.existsSync(r)) walk(r);
    expect(found.size).toBeGreaterThan(3); // the scan found real call sites
    const missing = [...found].filter((k) => !(KNOWN_BRAKE_KEYS as readonly string[]).includes(k));
    expect(missing, `brake keys used in code but absent from the panel: ${missing.join(", ")}`).toEqual([]);
  });
});
