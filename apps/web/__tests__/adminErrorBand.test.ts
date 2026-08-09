import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// #945 — the admin console's one systemic defect class: a page reads Supabase,
// coalesces the failure into `?? []` / `?? 0`, and renders it identically to a
// healthy-empty result. The operator reads "0 pending, all quiet" during an
// outage and acts on it.
//
// The sweep fixed every page that existed when it ran. This test is what stops
// the NEXT admin page arriving without the pattern — the defect kept coming
// back precisely because nothing enforced it.
//
// The rule is deliberately coarse: any admin page that talks to the database
// must import the shared band. It cannot verify that every individual query is
// instrumented (that needs real type information, and a regex over
// destructuring patterns false-positives on the positional `Promise.all` shape
// this codebase uses). What it does guarantee is that the page has a place to
// put an error and an author who had to think about it — which is the step that
// was being skipped.

const ADMIN_DIR = path.join(__dirname, "..", "app", "admin");
const BAND = "QueryErrorBand";

/**
 * Pages that read the database but legitimately don't import the band, each
 * with the reason. An entry here is a claim someone has to defend at review;
 * an empty reason is not allowed.
 */
const ALLOWLIST: Record<string, string> = {
  "health/page.tsx":
    "renders its own richer per-check error band (#929) — the shared band would duplicate it",
  "weekly-review/page.tsx":
    "carries its own per-query band with runbook-specific copy (#950)",
  "email-studio/page.tsx":
    "goes further than a band: a failed read makes every field show a REGISTRY DEFAULT, so saving would overwrite real copy. The page passes loadFailed into EmailStudio, which blocks the editor entirely rather than annotating it",
  "report-card/page.tsx":
    "not an ops page — it is the LinkedIn carousel surface rendered headlessly by the monthly GHA; a band would print into the published PDF. Its data errors surface as an explicit `report-card error:` render instead",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

describe("admin pages surface their query failures", () => {
  const pages = walk(ADMIN_DIR);

  it("finds the admin pages at all (guards against a silently-empty sweep)", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  it("every db-reading admin page imports QueryErrorBand or is allowlisted with a reason", () => {
    const offenders: string[] = [];
    for (const file of pages) {
      const rel = path.relative(ADMIN_DIR, file);
      const src = fs.readFileSync(file, "utf8");
      // "Talks to the database" = builds a service client. Pages that only
      // render static copy or delegate entirely to a client component don't.
      if (!src.includes("createServiceClient")) continue;
      if (src.includes(BAND)) continue;
      if (ALLOWLIST[rel]) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `These admin pages read the database but cannot show a failed read:\n` +
        offenders.map((o) => `  - app/admin/${o}`).join("\n") +
        `\n\nWire ${BAND} (see app/admin/blog/page.tsx for the page-body shape, ` +
        `app/admin/onward-reports/page.tsx for the threaded-helper shape), or add ` +
        `an ALLOWLIST entry in this file explaining why the page is exempt.`,
    ).toEqual([]);
  });

  it("every allowlist entry names a real page and carries a reason", () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(
        fs.existsSync(path.join(ADMIN_DIR, rel)),
        `allowlisted page app/admin/${rel} no longer exists — drop the entry`,
      ).toBe(true);
      expect(reason.length, `allowlist entry ${rel} needs a reason`).toBeGreaterThan(20);
    }
  });
});
