import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every feature-brake read picks its failure policy on purpose.
 *
 * `brakeState()` (packages/scam-engine/src/cost-log.ts) is the one read of
 * `feature_brakes`, and it has three outcomes: engaged, clear, and unknown (the
 * read itself failed). Callers pick what `unknown` means through one of two
 * wrappers:
 *
 *   - `isFeatureBrakedOrUnknown` FAILS CLOSED. The rule: use it wherever the
 *     brake protects paid vendor spend or outbound sends from a background Lane
 *     or an operator action. A fail-open read on a paid path is how the
 *     2026-07-12 urlscan quota breach happened.
 *   - `isFeatureBraked` FAILS OPEN. It is allowed ONLY at the sites listed in
 *     FAIL_OPEN_SITES, each with its reason. Today those are user-facing request
 *     paths, where fail-closed turns a DB hiccup into "unavailable" for a
 *     person mid-check (founder decision 2026-09-27), plus paths with no paid
 *     vendor.
 *
 * Before 2026-09-27 the policy was implicit. Four hand-rolled copies read the
 * table directly (reddit-intel, vuln, apivoid, phone-footprint, plus the
 * clone-watch batch send), and ten paid background Lanes used the fail-open
 * wrapper by default. This test makes the choice a reviewed edit:
 *
 *   1. a new `isFeatureBraked(` call site outside FAIL_OPEN_SITES fails, and
 *   2. a new raw `.from("feature_brakes").select(` outside RAW_READERS fails.
 *
 * Verified go-red: reverting monthly-intel-blog.ts to `isFeatureBraked(` fails
 * (1) naming that file, and re-adding apivoid's inline select fails (2).
 */

const REPO = path.join(process.cwd(), "../..");
const ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "__tests__", ".output", ".wxt"]);

/** Repo-relative file → why an unreadable brake should let this path run. */
const FAIL_OPEN_SITES: Record<string, string> = {
  "apps/web/app/api/image-check/route.ts":
    "user-facing request; Hive is an optional enrichment on a live check",
  "apps/web/app/api/extension/analyze-image/route.ts":
    "user-facing request (extension right-click check); Hive + vision are optional legs",
  "apps/web/app/api/extension/analyze-ad/route.ts":
    "user-facing request (extension ad check); Hive is an optional leg",
  "apps/web/app/api/scam-contacts/report/route.ts":
    "user-facing report; the brake only skips Twilio enrichment, the report is still accepted",
  "packages/bot-core/src/analyze.ts":
    "user-facing bot reply; fail-closed would answer a person with 'unavailable'",
  "packages/scam-engine/src/document-check/packs/au.ts":
    "no paid vendor on this path (ABR lookups are free); the brake is an operator kill-switch",
};

/** Files allowed to read `feature_brakes` directly. */
const RAW_READERS = new Set([
  // The one read, behind both policy wrappers.
  "packages/scam-engine/src/cost-log.ts",
  // Bulk status reads for display/judgement, not a gate on spending.
  "apps/web/app/api/cron/health-digest/route.ts",
  "apps/web/lib/dashboard/feature-brakes.ts",
  "apps/web/app/admin/page.tsx", // count of engaged brakes for the admin home tile
]);

let cache: { rel: string; code: string }[] | null = null;

/** Comments stripped so doc prose naming a wrapper is not a call site. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sources(): { rel: string; code: string }[] {
  if (cache) return cache;
  const out: { rel: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
        out.push({
          rel: path.relative(REPO, full),
          code: stripComments(fs.readFileSync(full, "utf8")),
        });
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  if (out.length < 500) {
    throw new Error(`source scan found ${out.length} files under ${REPO} — the walk is wrong`);
  }
  cache = out;
  return out;
}

describe("feature-brake read policy", () => {
  it("fail-open isFeatureBraked( is used only at the reasoned sites", () => {
    const callers = sources()
      .filter(({ rel, code }) => rel !== "packages/scam-engine/src/cost-log.ts" && /\bisFeatureBraked\(/.test(code))
      .map(({ rel }) => rel)
      .sort();
    const unlisted = callers.filter((rel) => !FAIL_OPEN_SITES[rel]);
    expect(
      unlisted,
      "these files use the FAIL-OPEN brake read. Paid or outbound background work must use " +
        "isFeatureBrakedOrUnknown; if fail-open is really right, add the file to FAIL_OPEN_SITES with the reason",
    ).toEqual([]);
  });

  it("every FAIL_OPEN_SITES entry still calls isFeatureBraked (no stale exemptions)", () => {
    const byRel = new Map(sources().map((s) => [s.rel, s.code]));
    for (const rel of Object.keys(FAIL_OPEN_SITES)) {
      const code = byRel.get(rel);
      expect(code, `${rel} no longer exists`).toBeDefined();
      expect(/\bisFeatureBraked\(/.test(code!), `${rel} is exempt but no longer reads fail-open`).toBe(true);
    }
  });

  it("nothing re-implements the feature_brakes read", () => {
    const raw = sources()
      .filter(({ code }) => /from\(\s*["']feature_brakes["']\s*\)\s*\.select\(/.test(code))
      .map(({ rel }) => rel)
      .filter((rel) => !RAW_READERS.has(rel))
      .sort();
    expect(
      raw,
      "these files read feature_brakes directly. Use brakeState / isFeatureBrakedOrUnknown / " +
        "isFeatureBraked from @askarthur/scam-engine/cost-log so the unknown-outcome policy is explicit",
    ).toEqual([]);
  });
});
