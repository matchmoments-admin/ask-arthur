/**
 * One-off backfill (#1069, from #1065): stamp `target_brand_normalized` on the
 * legacy clone alerts that predate the brand-convergence Seam (v195–v198).
 *
 * 36 open alerts (measured 2026-09-02) carry a NULL/empty brand key, so the
 * by-brand register (`aggregate_open_clone_alerts_by_brand`) cannot count them
 * — 1.2% of the open population invisible to /admin/brand-register.
 *
 * Derivation follows the live ingest (shopfront-nrd-daily-ingest
 * `buildUpsertRow`): resolve the alert's `inferred_target_domain` to its
 * watchlist entry via `legitimate_domains`, then `brandNormalize(entry.brand)`.
 *
 * One deliberate difference: the ingest matches against `getActiveWatchlist()`
 * — the static list MERGED with promoted `monitored_brands` rows — while this
 * reads only static `AU_BRAND_WATCHLIST`. An alert whose brand came from a
 * promoted entry is therefore reported unresolved rather than resolved. That
 * fails safe (nothing is guessed) and costs nothing today: `monitored_brands`
 * has 0 rows (checked 2026-09-03). Revisit if the overlay is ever populated.
 *
 * Rows whose domain is absent from the watchlist, or claimed by more than one
 * entry, are REPORTED, not guessed — never invent a brand key.
 *
 *   pnpm --filter @askarthur/web exec tsx scripts/backfill-brand-normalized.ts [--apply]
 *
 * Dry-run by default; pass --apply to write. Reads/writes prod via the
 * Management API (same endpoint as the MCP).
 */
import "./_load-env-config";
import { AU_BRAND_WATCHLIST, brandNormalize } from "@askarthur/shopfront-glue";

const PROJECT_REF = "rquomhcgnodxzkhokwni";

async function runSql(sql: string): Promise<unknown> {
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
  const body = await res.text();
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = (await runSql(
    // alert_state='open' matches what the header promises and what the
    // by-brand register actually counts; a retired/expired row gains nothing
    // from a brand key.
    `SELECT id, inferred_target_domain
       FROM shopfront_clone_alerts
      WHERE (target_brand_normalized IS NULL OR target_brand_normalized = '')
        AND inferred_target_domain IS NOT NULL
        AND alert_state = 'open'`,
  )) as Array<{ id: number; inferred_target_domain: string }>;

  // A domain claimed by MORE than one watchlist entry (my.gov.au and
  // servicesaustralia.gov.au, each shared by 3 gov entries as of 2026-09-03)
  // is ambiguous — the live matcher knew which entry actually hit; this
  // backfill cannot. Refuse rather than last-wins-guess (review finding on
  // #1072). All 36 current targets are google.com, which is single-entry.
  const byDomain = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of AU_BRAND_WATCHLIST) {
    for (const d of entry.legitimate_domains) {
      if (byDomain.has(d) && byDomain.get(d) !== entry.brand) ambiguous.add(d);
      byDomain.set(d, entry.brand);
    }
  }

  const updates: Array<{ id: number; key: string }> = [];
  const unresolved: Array<{ id: number; domain: string }> = [];
  for (const r of rows) {
    const brand = ambiguous.has(r.inferred_target_domain)
      ? null // ambiguous — report, never guess
      : byDomain.get(r.inferred_target_domain);
    const key = brand ? brandNormalize(brand) : null;
    if (key) updates.push({ id: r.id, key });
    else unresolved.push({ id: r.id, domain: r.inferred_target_domain });
  }

  console.log(`rows missing brand key : ${rows.length}`);
  console.log(`resolvable             : ${updates.length}`);
  console.log(`unresolved (left NULL) : ${unresolved.length}`);
  for (const u of unresolved) console.log(`  #${u.id} ${u.domain}`);

  if (!apply) {
    console.log("\ndry-run — pass --apply to write.");
    return;
  }
  if (updates.length === 0) return;

  // 36 rows — one statement, far under the 5K hot-table chunk rule.
  const values = updates
    .map((u) => `(${u.id}, '${u.key.replace(/'/g, "''")}')`)
    .join(", ");
  const result = await runSql(
    `UPDATE shopfront_clone_alerts t
        SET target_brand_normalized = v.key
       FROM (VALUES ${values}) AS v(id, key)
      WHERE t.id = v.id
        AND (t.target_brand_normalized IS NULL OR t.target_brand_normalized = '')
      RETURNING t.id`,
  );
  console.log(`\nupdated: ${(result as unknown[]).length} rows`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
