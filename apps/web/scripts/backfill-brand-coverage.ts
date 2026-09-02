/**
 * One-off backfill for `brand_coverage_history` (v294, #1075).
 *
 * Reconstructs when each brand entered clone-watch coverage by walking the git
 * history of the watchlist file and diffing consecutive snapshots. This is the
 * only place the information exists — nothing in the database recorded it, and
 * without it a coverage start is indistinguishable from a targeting rise (the
 * v294 migration header has the incident that prompted it).
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/backfill-brand-coverage.ts [--apply]
 *
 * Dry-run by default. Idempotent: rows upsert on (brand_normalized,
 * covered_from) and a re-run REFRESHES covered_to / brand_domain / brand. That
 * update matters — a brand de-listed after the last run only gets its
 * covered_to stamped on a re-run, and DO NOTHING would have silently kept
 * reporting it as covered while logging "already present".
 *
 * PARSING NOTE: watchlist entries are single-line objects —
 *   { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
 * so a `^\s*brand:` match finds only the handful of multi-line entries (55 of
 * 293). Match `brand: "..."` anywhere on the line instead. Guarded by
 * apps/web/__tests__/backfillBrandCoverage.test.ts, which asserts HEAD parses to
 * the full 293.
 */
import "./_load-env-config";
import { execFileSync } from "node:child_process";
import { brandNormalize } from "@askarthur/shopfront-glue";

const WATCHLIST_PATH = "packages/shopfront-glue/src/au-brand-watchlist.ts";
const PROJECT_REF = "rquomhcgnodxzkhokwni";

export interface CoverageRow {
  brand: string;
  brand_normalized: string;
  /** legitimate_domains[0], lowercased — the key the monthly stats use. */
  brand_domain: string;
  covered_from: string; // YYYY-MM-DD
  /**
   * Date the brand LEFT the watchlist, or null if still listed.
   *
   * Load-bearing in the opposite direction to covered_from: without it a
   * de-listed brand reads as permanently covered, so its drop to zero
   * detections publishes as "targeting collapsed" when the truth is "we
   * stopped looking". Two brands are already in this state — Domain
   * (domain.com.au) and Lendi (lendi.com.au) were FP-denylisted out of the
   * list.
   */
  covered_to: string | null;
  source: "git-backfill";
  source_ref: string; // commit sha
}

export interface WatchlistEntry {
  brand: string;
  /** legitimate_domains[0], lowercased. "" when the entry declares none. */
  primaryDomain: string;
}

/**
 * Entries in one revision of the watchlist file.
 *
 * Captures the display name AND legitimate_domains[0] together, because the
 * pipeline is keyed on the DOMAIN, not the name: lexical-match emits
 * `legitimate_domain: entry.legitimate_domains[0]`, the ingest writes it to
 * `inferred_target_domain`, and `clone_watch_monthly_brand_stats.brand` stores
 * that. Keying coverage on the name alone joins to nothing (v295).
 */
export function parseBrands(fileSource: string): WatchlistEntry[] {
  return [
    ...fileSource.matchAll(
      /brand:\s*"([^"]+)"[^}]*?legitimate_domains:\s*\[\s*"([^"]*)"/g,
    ),
  ].map((m) => ({ brand: m[1], primaryDomain: m[2].toLowerCase() }));
}

/**
 * Diff consecutive revisions into first-seen rows. A brand appearing in
 * revision N but not N-1 gets `covered_from` = revision N's date; brands in the
 * oldest revision get that revision's date (we cannot see further back, and the
 * migration header says so).
 */
export function buildCoverageRows(
  revisions: Array<{ sha: string; date: string; brands: WatchlistEntry[] }>,
): CoverageRow[] {
  // Dedupe on the BRAND key. An earlier version deduped on the domain, which
  // silently dropped every brand sharing a primary domain with another:
  // Services Australia, Medicare and Centrelink all list
  // servicesaustralia.gov.au, so Medicare and Centrelink got NO coverage row
  // at all and would have read as coverage_unknown forever — suppressed with
  // no error, and hidden because the total still reconciled to the watchlist
  // size. The domain is deliberately many-to-one.
  const seen = new Set<string>();
  const rows: CoverageRow[] = [];
  const byKey = new Map<string, CoverageRow>();
  for (const rev of revisions) {
    for (const entry of rev.brands) {
      const nameKey = brandNormalize(entry.brand);
      const domainKey = entry.primaryDomain;
      if (!nameKey || !domainKey || seen.has(nameKey)) continue;
      seen.add(nameKey);
      const row: CoverageRow = {
        brand: entry.brand,
        brand_normalized: nameKey,
        brand_domain: domainKey,
        covered_from: rev.date,
        covered_to: null,
        source: "git-backfill",
        source_ref: rev.sha,
      };
      rows.push(row);
      byKey.set(nameKey, row);
    }
  }

  // Close out brands that LEFT the list. Walk forward and stamp covered_to at
  // the first revision where a previously-present brand is absent. Without
  // this the gate treats a de-listed brand as still watched, and its silence
  // reads as "no longer targeted" — the exact inversion this table exists to
  // prevent, just pointing the other way.
  const closed = new Set<string>();
  for (let i = 1; i < revisions.length; i++) {
    const present = new Set(
      revisions[i].brands
        .map((e) => brandNormalize(e.brand))
        .filter((k): k is string => Boolean(k)),
    );
    for (const [key, row] of byKey) {
      if (closed.has(key)) continue;
      if (row.covered_from >= revisions[i].date) continue; // not yet listed
      if (!present.has(key)) {
        row.covered_to = revisions[i].date;
        closed.add(key);
      }
    }
  }
  return rows;
}

/**
 * Always run git from the repo ROOT. This script is invoked via
 * `pnpm --filter @askarthur/web`, whose cwd is apps/web, so a repo-relative
 * pathspec silently matches nothing and the backfill reports zero revisions —
 * a wrong answer that looks like a clean run. Caught by
 * __tests__/backfillBrandCoverage.test.ts.
 */
export function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", repoRoot(), ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function runSql(sql: string): Promise<{ status: number; body: string }> {
  const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  return { status: res.status, body: await res.text() };
}

async function main() {
  const apply = process.argv.includes("--apply");

  // Oldest first, so the diff walks forward in time.
  const log = git([
    "log",
    "--follow",
    "--reverse",
    "--format=%H %ad",
    "--date=short",
    "--",
    WATCHLIST_PATH,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);

  const revisions = log.map((line) => {
    const [sha, date] = line.split(" ");
    const src = git(["show", `${sha}:${WATCHLIST_PATH}`]);
    return { sha, date, brands: parseBrands(src) };
  });

  console.log(`watchlist revisions: ${revisions.length}`);
  for (const r of revisions) {
    console.log(`  ${r.date}  ${r.sha.slice(0, 8)}  brands=${r.brands.length}`);
  }

  const rows = buildCoverageRows(revisions);
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.covered_from, (byDate.get(r.covered_from) ?? 0) + 1);
  console.log(`\ncoverage rows: ${rows.length}`);
  for (const [d, n] of [...byDate].sort()) console.log(`  ${d}  +${n} brands`);

  if (!apply) {
    console.log("\ndry-run — pass --apply to write.");
    return;
  }

  // Batched upsert. Idempotent on the PK, so re-running is safe and picks up
  // only brands added since the last run.
  const CHUNK = 100;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk
      .map(
        (r) =>
          `(${lit(r.brand)}, ${lit(r.brand_normalized)}, ${lit(r.brand_domain)}, ${lit(r.covered_from)}::date, ${r.covered_to ? `${lit(r.covered_to)}::date` : "NULL"}, ${lit(r.source)}, ${lit(r.source_ref)})`,
      )
      .join(", ");
    const { status, body } = await runSql(
      `INSERT INTO brand_coverage_history
         (brand, brand_normalized, brand_domain, covered_from, covered_to, source, source_ref)
       VALUES ${values}
       ON CONFLICT (brand_normalized, covered_from) DO UPDATE
         SET covered_to = EXCLUDED.covered_to,
             brand_domain = EXCLUDED.brand_domain,
             brand = EXCLUDED.brand
       RETURNING brand_normalized`,
    );
    if (status >= 300) throw new Error(`HTTP ${status}: ${body.slice(0, 400)}`);
    written += (JSON.parse(body) as unknown[]).length;
  }
  console.log(`\ninserted: ${written} new rows (${rows.length - written} already present)`);
}

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

if (process.argv[1]?.includes("backfill-brand-coverage")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
