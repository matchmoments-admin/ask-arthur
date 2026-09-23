import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BRAKE_SPEND_FEATURES, brakeSpend } from "@/lib/cost-brakes";
import { KNOWN_BRAKE_KEYS } from "@/lib/dashboard/feature-brakes";

// BRAKE_SPEND_FEATURES is the one list of cost_telemetry features each cost
// brake sums. The inline lists it replaced rotted: on 2026-09-24 five terms
// had no writer anywhere (three deleted clone-watch lanes, two never-emitted
// shop-signal diagnostics). This walks every place a cost_telemetry row can
// be written from — TS in apps/ + packages/, Python scrapers in pipeline/,
// edge functions in supabase/functions/ — and fails if a listed feature has
// no writer, so a deleted lane cannot leave its tag in a brake again.

const REPO = path.join(process.cwd(), "../..");
const ROOTS = ["apps", "packages", "pipeline", "supabase/functions"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "__tests__",
  ".output",
  ".wxt",
]);
// The registry and the cron that consumes it name every feature by
// construction; counting them would make the test vacuous.
const SELF = new Set([
  path.join(REPO, "apps/web/lib/cost-brakes.ts"),
  path.join(REPO, "apps/web/app/api/cron/cost-daily-check/route.ts"),
]);

function sources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (
        /\.(ts|tsx|py)$/.test(e.name) &&
        !/\.test\.tsx?$/.test(e.name) &&
        !/^test_.*\.py$/.test(e.name) &&
        !SELF.has(full)
      ) {
        out.push({ file: full, src: fs.readFileSync(full, "utf8") });
      }
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(REPO, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** A WRITE of the tag, not a mention: the literal assigned to a `feature`
 *  key (`feature: "x"`, Python `"feature": "x"` / `feature="x"`), passed as a
 *  backfill `costFeature`, or bound to a `*FEATURE` constant that writers
 *  use. Reads (`.eq("feature", "x")`) and comments do not count. */
function writerPattern(feature: string): RegExp {
  const lit = `["'\`]${escape(feature)}["'\`]`;
  return new RegExp(
    `(?:\\b(?:feature|costFeature)["']?\\s*[:=]\\s*${lit})|(?:\\b\\w*FEATURE\\w*\\s*=\\s*${lit})`,
  );
}

function writerless(features: readonly string[]): string[] {
  const files = sources();
  return features.filter(
    (f) => !files.some(({ src }) => writerPattern(f).test(src)),
  );
}

describe("BRAKE_SPEND_FEATURES", () => {
  const all = Object.values(BRAKE_SPEND_FEATURES).flat() as string[];

  it("every listed spend feature has a writer somewhere in the repo", () => {
    const dead = writerless(all);
    expect(
      dead,
      `features summed toward a brake that nothing writes: ${dead.join(", ")}`,
    ).toEqual([]);
  });

  it("the writer scan can see a real writer and rejects an unwritten tag", () => {
    // Go-red guard: without this, a scan that walked the wrong directory
    // would pass the test above vacuously.
    expect(writerless(["shopfront_clone_preclassify"])).toEqual([]);
    expect(writerless(["reddit-intel-classify"])).toEqual([]);
    expect(writerless(["shopfront_clone_poll_netcraft"])).toEqual([
      "shopfront_clone_poll_netcraft",
    ]);
  });

  it("every brake key is one workers actually check", () => {
    const unknown = Object.keys(BRAKE_SPEND_FEATURES).filter(
      (k) => !(KNOWN_BRAKE_KEYS as readonly string[]).includes(k),
    );
    expect(unknown).toEqual([]);
  });

  it("no feature is summed toward two brakes", () => {
    const dupes = all.filter((f, i) => all.indexOf(f) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("brakeSpend", () => {
  it("sums every provider row of every listed feature and ignores the rest", () => {
    const rows = [
      { feature: "charity_check", cost: 0.5 },
      { feature: "charity_check", cost: 0.25 }, // second provider row
      { feature: "hive_ai", cost: 9 },
    ];
    expect(brakeSpend(rows, "charity_check")).toBe(0.75);
    expect(brakeSpend(rows, "shopfront_clone_outreach")).toBe(0);
  });
});
