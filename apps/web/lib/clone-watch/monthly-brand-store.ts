/**
 * The Monthly Brand Store — `clone_watch_monthly_brand_stats` (v193 → v319).
 *
 * ONE producer, many readers. `clone-watch-report-summary` computes a month
 * once and writes it here through `write_clone_watch_monthly_stats` (v319);
 * everything that prints a per-brand monthly clone number reads it back: the
 * report card's trend rows, targeting intelligence, the monthly blog, brand
 * coverage, and — since v319 — the brand-stewardship ledger, which used to
 * re-fetch the month's alerts and refold the same counts two hours earlier on
 * a different clock.
 *
 * What this Module owns (the Interface):
 *   - the store's row shape beyond the v193–v296 trend columns (the v319 key,
 *     membership and event-dated columns) and how they are folded from the
 *     cohort rows — pure, so the fold is testable from fixtures;
 *   - the WRITE, which goes through the SQL writer so a published month cannot
 *     be restated by a re-run (the freeze lives in SQL, not here: this file
 *     only reports what the writer decided);
 *   - the READ the stewardship ledger does, and the mapping of a store row +
 *     its member alerts' current state onto the ledger's `metrics.clones`.
 *
 * Deletion test: deleting this Module scatters the freeze protocol (status
 * vocabulary, when to emit the completion event), the membership read and the
 * ledger mapping back into two Inngest functions that previously each owned a
 * fold of the same month. It concentrates; it is not a pass-through.
 *
 * Grain: still the brand's PRIMARY DOMAIN (`brand`). `brand_normalized` is the
 * Canonical Brand key beside it (ADR-0020, 2026-09-23 amendment) — re-keying
 * the grain would restate frozen editions.
 */
import { brandNormalize } from "@askarthur/shopfront-glue";
import type { createServiceClient } from "@askarthur/supabase/server";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { logger } from "@askarthur/utils/logger";
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import {
  ACTIVE_STOCK_STATUSES,
  STOCK_STATUSES,
  topRiskUnactioned,
  type CloneBrandMetrics,
  type StockStatus,
} from "@/lib/clone-watch/clone-metrics";
import type { MonthWindow } from "@/lib/clone-watch/month-window";
import type { CloneWatchTrendRows, FrozenMonth } from "@/lib/clone-watch/report-card";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/** Emitted by clone-watch-report-summary once a month's store is in place;
 *  consumed by report-brand-stewardship (which used to run 2h BEFORE it). */
export const MONTHLY_STORE_WRITTEN_EVENT = "clone-watch/monthly-store.written.v1";

export interface MonthlyStoreWrittenData {
  /** "YYYY-MM-01" */
  periodMonth: string;
  status: StoreWriteStatus;
  frozenAt: string | null;
}

// ── Fold helpers (pure) ─────────────────────────────────────────────────────

/** One witnessed/vendor-dated takedown (submitted_to.netcraft.takedown_at,
 *  v219/v314). Undated takedowns are not events and never appear here. */
export interface TakedownEvent {
  brandDomain: string;
  candidateDomain: string;
  takedownAt: string; // ISO
}

/** Postgres renders jsonb timestamps as "2026-07-26 10:01:14.78+00". */
function parseTs(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Takedown events from alert rows of ANY first-seen month. fp-triaged rows are
 * dropped (the cohort rule); fp-BRAND rows need no filter here because the
 * counts are only attached to brands that have a store row, and a denylisted
 * brand never gets one.
 */
export function takedownEventsFromRows(
  rows: Array<
    Pick<CloneAlertRow, "inferred_target_domain" | "candidate_domain" | "submitted_to" | "triage_status">
  >,
): TakedownEvent[] {
  const out: TakedownEvent[] = [];
  for (const r of rows) {
    if (r.triage_status === "fp") continue;
    const brandDomain = r.inferred_target_domain?.trim().toLowerCase();
    if (!brandDomain || !r.candidate_domain) continue;
    const netcraft = r.submitted_to?.["netcraft"] as { takedown_at?: unknown } | undefined;
    const ms = parseTs(netcraft?.takedown_at);
    if (ms === null) continue;
    out.push({
      brandDomain,
      candidateDomain: r.candidate_domain,
      takedownAt: new Date(ms).toISOString(),
    });
  }
  return out;
}

/** Distinct lookalikes per brand whose takedown HAPPENED inside the window. */
export function takedownsInMonthByBrand(
  events: TakedownEvent[],
  window: Pick<MonthWindow, "startIso" | "endIso">,
): Map<string, number> {
  const start = Date.parse(window.startIso);
  const end = Date.parse(window.endIso);
  const seen = new Map<string, Set<string>>();
  for (const e of events) {
    const at = Date.parse(e.takedownAt);
    if (!(at >= start && at < end)) continue;
    let s = seen.get(e.brandDomain);
    if (!s) seen.set(e.brandDomain, (s = new Set()));
    s.add(e.candidateDomain);
  }
  return new Map([...seen].map(([b, s]) => [b, s.size]));
}

/**
 * Cohort members with weaponised_at set, per brand, deduped exactly as
 * aggregateClonesByDomain dedupes (first row per candidate within a brand), so
 * it is a subset of that brand's `clones` by construction.
 */
export function weaponisedEverByBrand(rows: CloneAlertRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const brand = r.inferred_target_domain?.trim().toLowerCase();
    if (!brand || !r.candidate_domain) continue;
    let s = seen.get(brand);
    if (!s) seen.set(brand, (s = new Set()));
    if (s.has(r.candidate_domain)) continue;
    s.add(r.candidate_domain);
    if (!out.has(brand)) out.set(brand, 0);
    if (r.weaponised_at) out.set(brand, out.get(brand)! + 1);
  }
  return out;
}

// ── Month-end stock (v325) ──────────────────────────────────────────────────

/** One clone_liveness_snapshots row, as the summary reads it. */
export interface StockSnapshotRow {
  brand: string;
  status: StockStatus;
  checked_at: string;
}

/**
 * Above this share of `unverified` rows (resolver proved nothing, or the run
 * never reached the name), a brand's active count is not a measurement: a bad
 * resolver night would otherwise read as "0 lookalikes up". Normal is ~5%
 * (review sample: 8 of 150 SERVFAIL/timeout).
 */
export const STOCK_UNVERIFIED_MAX_SHARE = 0.2;

export interface BrandStock {
  /** live_phishing + live + parked — the lookalikes still up at month end. */
  active: number;
  /** False when unverified rows exceed STOCK_UNVERIFIED_MAX_SHARE — the
   *  brand's active_stock_eom then persists NULL, its byStatus still stands. */
  measured: boolean;
  /** Every status, zero-filled, so a reader never has to guess a missing key. */
  byStatus: Record<StockStatus, number>;
}

function emptyByStatus(): Record<StockStatus, number> {
  return Object.fromEntries(STOCK_STATUSES.map((s) => [s, 0])) as Record<
    StockStatus,
    number
  >;
}

/**
 * The month-end snapshot folded per brand, or `null` when there IS no
 * snapshot for the month.
 *
 * `null` vs a zero is the whole contract: `null` persists as
 * active_stock_eom NULL ("never measured"), because a month whose liveness
 * run did not happen has no stock figure — publishing 0 would claim every
 * lookalike was down. An empty array is treated the same as `null` for that
 * reason: the snapshot covers ALL active stock (~3k domains), so a month with
 * zero snapshot rows is a run that did not happen, not a clean month.
 *
 * A brand with no rows in a snapshot that DID run genuinely has no stock —
 * `stockForBrand` returns zeros for it.
 */
export function foldStockSnapshot(
  snapshots: StockSnapshotRow[] | null | undefined,
): { byBrand: Map<string, BrandStock>; checkedAt: string } | null {
  if (!snapshots || snapshots.length === 0) return null;
  const byBrand = new Map<string, BrandStock>();
  let checkedAt = "";
  for (const s of snapshots) {
    const brand = s.brand.trim().toLowerCase();
    let b = byBrand.get(brand);
    if (!b) byBrand.set(brand, (b = { active: 0, measured: true, byStatus: emptyByStatus() }));
    b.byStatus[s.status] = (b.byStatus[s.status] ?? 0) + 1;
    if (ACTIVE_STOCK_STATUSES.has(s.status)) b.active += 1;
    if (s.checked_at > checkedAt) checkedAt = s.checked_at;
  }
  for (const b of byBrand.values()) {
    const total = STOCK_STATUSES.reduce((n, k) => n + b.byStatus[k], 0);
    b.measured = b.byStatus.unverified <= total * STOCK_UNVERIFIED_MAX_SHARE;
  }
  return { byBrand, checkedAt };
}

export function stockForBrand(
  folded: NonNullable<ReturnType<typeof foldStockSnapshot>>,
  brand: string,
): BrandStock {
  return (
    folded.byBrand.get(brand.trim().toLowerCase()) ?? {
      active: 0,
      measured: true,
      byStatus: emptyByStatus(),
    }
  );
}

/**
 * The pre-classifier(s) that judged a brand's cohort (model_id), deduped per
 * candidate like every other count: the model ids joined with "+", most
 * frequent first, ties alphabetical (deterministic on re-run). A mix is kept
 * whole on purpose — a month that straddles a classifier swap (Haiku → Jev,
 * 2026-09-22) must say so, not read as whichever model had more rows.
 * Absent from the map = no member has a classification.
 */
export function classifierVersionByBrand(
  rows: CloneAlertRow[],
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const brand = r.inferred_target_domain?.trim().toLowerCase();
    if (!brand || !r.candidate_domain) continue;
    let s = seen.get(brand);
    if (!s) seen.set(brand, (s = new Set()));
    if (s.has(r.candidate_domain)) continue;
    s.add(r.candidate_domain);
    const model = r.clone_watch_classifications?.model_id;
    if (!model) continue;
    let c = counts.get(brand);
    if (!c) counts.set(brand, (c = new Map()));
    c.set(model, (c.get(model) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [brand, c] of counts) {
    const models = [...c.entries()]
      .sort(([a, na], [b, nb]) => nb - na || (a < b ? -1 : a > b ? 1 : 0))
      .map(([m]) => m);
    out.set(brand, models.join("+"));
  }
  return out;
}

/**
 * The Canonical Brand key for a domain-grain row. SQL twin: the v319 backfill
 * (keep the two in step — monthlyBrandStoreSql.test.ts asserts parity).
 *
 *   1. the domain's ONE coverage-history mapping, when it has exactly one;
 *   2. else, from the pool of coverage + alert keys, the one equal to the
 *      domain's first label (the domain's owner — servicesaustralia.gov.au →
 *      "servicesaustralia", not the "medicare" majority);
 *   3. else the most frequent alert key (ties alphabetical; coverage-only keys
 *      rank below any alert key);
 *   4. else the normalised first label.
 */
export function brandKeyForDomain(
  domain: string,
  alertKeys: Array<string | null | undefined>,
  coverage: BrandCoverage[] | null,
): string | null {
  const d = domain.trim().toLowerCase();
  const covKeys = [
    ...new Set(
      (coverage ?? [])
        .filter((c) => c.brandDomain?.trim().toLowerCase() === d && c.brandNormalized)
        .map((c) => c.brandNormalized),
    ),
  ];
  if (covKeys.length === 1) return covKeys[0];

  const counts = new Map<string, number>();
  for (const k of covKeys) counts.set(k, 0);
  for (const k of alertKeys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);

  const label = brandNormalize(d.split(".")[0]);
  const ranked = [...counts.entries()].sort(
    ([a, na], [b, nb]) =>
      Number(b === label) - Number(a === label) || nb - na || (a < b ? -1 : a > b ? 1 : 0),
  );
  return ranked[0]?.[0] ?? label;
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 *  written      — month was unfrozen; now written and frozen
 *  republished  — month was frozen; restated on purpose (p_republish)
 *  frozen       — month was frozen; NOTHING written (a re-run cannot restate)
 *  empty        — the month had no clones; nothing to write (caller-side)
 */
export type StoreWriteStatus = "written" | "republished" | "frozen" | "empty";

export interface StoreWriteResult {
  status: Exclude<StoreWriteStatus, "empty">;
  frozenAt: string | null;
  previousFrozenAt: string | null;
  brandRows: number;
  registrarRows: number;
}

/** When a month is frozen, or null when it has not been published. */
export async function readMonthFrozenAt(
  sb: ServiceClient,
  periodMonth: string, // "YYYY-MM-01"
): Promise<string | null> {
  const { data, error } = await sb
    .from("clone_watch_monthly_brand_stats")
    .select("frozen_at")
    .eq("period_month", periodMonth)
    .not("frozen_at", "is", null)
    .limit(1);
  if (error) throw new Error(`monthly store freeze read failed: ${error.message}`);
  return ((data ?? [])[0] as { frozen_at?: string } | undefined)?.frozen_at ?? null;
}

/**
 * Write a month through the ONE SQL writer (v319): atomic, per-month
 * serialised, and refusing a frozen month unless `republish`. Brand AND
 * registrar rows are one transaction — the old two-call delete-then-insert
 * could lose a month between the calls.
 */
export async function writeMonthlyStats(
  sb: ServiceClient,
  rows: CloneWatchTrendRows,
  opts: { republish: boolean },
): Promise<StoreWriteResult> {
  const { data, error } = await sb.rpc("write_clone_watch_monthly_stats", {
    p_period_month: rows.periodMonth,
    p_brand_rows: rows.brandRows,
    p_registrar_rows: rows.registrarRows,
    p_republish: opts.republish,
  });
  if (error) throw new Error(`monthly store write failed: ${error.message}`);
  const r = (data ?? {}) as {
    status?: string;
    frozen_at?: string | null;
    previous_frozen_at?: string | null;
    brand_rows?: number;
    registrar_rows?: number;
  };
  if (r.status !== "written" && r.status !== "republished" && r.status !== "frozen") {
    throw new Error(`monthly store write returned unknown status "${String(r.status)}"`);
  }
  return {
    status: r.status,
    frozenAt: r.frozen_at ?? null,
    previousFrozenAt: r.previous_frozen_at ?? null,
    brandRows: r.brand_rows ?? 0,
    registrarRows: r.registrar_rows ?? 0,
  };
}

/** Why a month's stock figure is or is not trusted (Outcome Row + warn). */
export type StockState = "measured" | "no_run" | "partial" | "read_error";

/**
 * The two v325 reads the monthly store needs and no other card surface does:
 * the month-end liveness snapshot and the feed denominator. Called by the
 * summary's write path only (the admin preview and digests never pay for it).
 *
 * The snapshot is trusted ONLY when the run's completion record
 * (clone_liveness_runs) exists and the snapshot holds exactly the rows it
 * says it wrote. A run that died mid-walk leaves a partial snapshot, and
 * folding it would freeze a fabricated 0 for every brand whose stock sat in
 * the unreached ids — so it persists NULL instead (review of #1225).
 *
 * DEGRADES rather than throws, like the takedown-events read: a failure
 * persists NULL ("not measured") for the affected columns and is warn-logged,
 * because a lost stock figure must not cost the month its store row.
 */
export async function loadStoreV2Inputs(
  sb: ServiceClient,
  window: Pick<MonthWindow, "periodMonth" | "startIso" | "endIso">,
): Promise<{
  stockSnapshots: StockSnapshotRow[] | null;
  sweptDomains: number | null;
  stockState: StockState;
  stockReadError: string | null;
}> {
  let stockSnapshots: StockSnapshotRow[] | null = null;
  let stockState: StockState = "read_error";
  let stockReadError: string | null = null;
  try {
    const run = await sb
      .from("clone_liveness_runs")
      .select("written")
      .eq("period_month", window.periodMonth)
      .maybeSingle();
    if (run.error) throw new Error(run.error.message);
    const written = (run.data as { written?: number } | null)?.written;
    if (written == null) {
      stockState = "no_run";
    } else {
      const { rows, error } = await fetchAllRows<StockSnapshotRow>((from, to) =>
        sb
          .from("clone_liveness_snapshots")
          .select("brand, status, checked_at")
          .eq("period_month", window.periodMonth)
          .order("alert_id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: StockSnapshotRow[] | null;
          error: { message: string } | null;
        }>,
      );
      if (error) throw new Error(error.message);
      if (rows.length !== written) {
        stockState = "partial";
        stockReadError = `snapshot has ${rows.length} rows, run recorded ${written}`;
      } else {
        stockState = "measured";
        stockSnapshots = rows;
      }
    }
  } catch (err) {
    stockState = "read_error";
    stockReadError = err instanceof Error ? err.message : String(err);
  }
  if (stockState !== "measured") {
    logger.warn("monthly-brand-store: month-end stock not measured", {
      period: window.periodMonth,
      stockState,
      error: stockReadError,
      consequence: "active_stock_eom persisted as null (not measured)",
    });
  }

  const sweptDomains = await readSweptDomains(sb, window);

  return { stockSnapshots, sweptDomains, stockState, stockReadError };
}

/**
 * NRD domains swept in the month (the feed denominator), or null when not
 * recorded / not covering the month / the read failed. Degrades, never throws.
 * Shared by the store write path and the report card's feed-shift check.
 */
export async function readSweptDomains(
  sb: ServiceClient,
  window: Pick<MonthWindow, "periodMonth" | "startIso" | "endIso">,
): Promise<number | null> {
  try {
    const { data, error } = await sb
      .from("cost_telemetry")
      .select("metadata, created_at")
      .eq("feature", "shopfront_clone_watch")
      .eq("operation", "nrd_daily_ingest")
      .gte("created_at", window.startIso)
      .lt("created_at", window.endIso)
      .limit(1000);
    if (error) throw new Error(error.message);
    return sumDomainsScanned(
      (data ?? []) as Array<{ metadata: unknown; created_at: string }>,
      window.startIso,
    );
  } catch (err) {
    logger.warn("monthly-brand-store: swept-domains read failed", {
      period: window.periodMonth,
      error: err instanceof Error ? err.message : String(err),
      consequence: "swept_domains persisted as null (not recorded)",
    });
    return null;
  }
}

/**
 * The FROZEN store for the given months (#1226) — what each month PUBLISHED,
 * for the report card's month-over-month comparison. A month with no frozen
 * row is simply absent from the map (never published). null = the read
 * failed; the card then falls back to its live recount and says so.
 */
export async function readFrozenMonths(
  sb: ServiceClient,
  periodMonths: readonly string[],
): Promise<Map<string, FrozenMonth> | null> {
  const { rows, error } = await fetchAllRows<{
    period_month: string;
    brand: string;
    clones: number | null;
    matcher_version: string | null;
    swept_domains: number | string | null;
  }>((from, to) =>
    sb
      .from("clone_watch_monthly_brand_stats")
      .select("period_month, brand, clones, matcher_version, swept_domains")
      .in("period_month", periodMonths as string[])
      .not("frozen_at", "is", null)
      .order("period_month", { ascending: true })
      .order("brand", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: Array<{
        period_month: string;
        brand: string;
        clones: number | null;
        matcher_version: string | null;
        swept_domains: number | string | null;
      }> | null;
      error: { message: string } | null;
    }>,
  );
  if (error) {
    logger.warn("monthly-brand-store: frozen-month read failed", {
      months: periodMonths,
      error: error.message,
      consequence: "month-over-month falls back to the live recount",
    });
    return null;
  }
  return foldFrozenMonths(rows);
}

/** Pure half of `readFrozenMonths`. */
export function foldFrozenMonths(
  rows: ReadonlyArray<{
    period_month: string;
    brand: string;
    clones: number | null;
    matcher_version: string | null;
    swept_domains: number | string | null;
  }>,
): Map<string, FrozenMonth> {
  const out = new Map<string, FrozenMonth>();
  for (const r of rows) {
    const month = r.period_month.slice(0, 10);
    let m = out.get(month);
    if (!m) {
      m = { byBrand: new Map(), total: 0, brands: 0, matcherVersion: null, sweptDomains: null };
      out.set(month, m);
    }
    const n = Number(r.clones ?? 0);
    const brand = r.brand.trim().toLowerCase();
    m.byBrand.set(brand, (m.byBrand.get(brand) ?? 0) + n);
    m.total += n;
    if (n > 0) m.brands += 1;
    // One value per month by construction (the writer stamps every row).
    if (r.matcher_version && !m.matcherVersion) m.matcherVersion = r.matcher_version;
    const swept = r.swept_domains == null ? null : Number(r.swept_domains);
    if (swept != null && Number.isFinite(swept) && m.sweptDomains == null) m.sweptDomains = swept;
  }
  return out;
}

/**
 * The month's first ingest row must land within this many days of the month
 * start, or the sum is a fraction of the feed (telemetry began 2026-06-27, so
 * June would read ~280k against ~2.1M). SQL twin: the v325 backfill's HAVING.
 */
export const SWEPT_COVERAGE_GRACE_DAYS = 3;

/**
 * Sum of nrd_daily_ingest `domains_scanned`; null when no ingest row carried
 * the key, or when telemetry does not cover the month from its start.
 */
export function sumDomainsScanned(
  rows: Array<{ metadata: unknown; created_at?: string }>,
  monthStartIso?: string,
): number | null {
  let total = 0;
  let seen = 0;
  let first = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const n = Number((r.metadata as { domains_scanned?: unknown } | null)?.domains_scanned);
    if (!Number.isFinite(n)) continue;
    total += n;
    seen += 1;
    if (r.created_at) first = Math.min(first, Date.parse(r.created_at));
  }
  if (seen === 0) return null;
  if (
    monthStartIso &&
    first >= Date.parse(monthStartIso) + SWEPT_COVERAGE_GRACE_DAYS * 24 * 3600_000
  ) {
    return null;
  }
  return total;
}

/**
 * Should the completion event fire, i.e. should stewardship prepare this
 * month? Once per published month:
 *   - a fresh write or a deliberate re-publish: yes;
 *   - the SCHEDULED run finding the month already frozen (its own retry after
 *     the write committed, or an operator published it early): yes — the
 *     scheduled run is the month's one trigger;
 *   - a MANUAL re-run that found it frozen: no — it changed nothing;
 *   - a month with no clones: only on the scheduled run (onward + Reddit
 *     mentions still have a month to report).
 */
export function shouldEmitStoreWritten(
  status: StoreWriteStatus,
  ctx: { scheduled: boolean },
): boolean {
  if (status === "written" || status === "republished") return true;
  return ctx.scheduled;
}

// ── Read (the stewardship ledger) ───────────────────────────────────────────

/** The columns the stewardship ledger reads. */
export interface LedgerStoreRow {
  brand: string;
  clones: number;
  reported_to_netcraft: number;
  taken_down: number;
  taken_down_in_month: number | null;
  declined: number;
  escalated: number;
  weaponised: number;
  weaponised_ever: number | null;
  weaponised_after_decline: number | null;
  re_taken_down: number | null;
  alert_ids: number[] | null;
  frozen_at: string | null;
}

const LEDGER_SELECT =
  "brand, clones, reported_to_netcraft, taken_down, taken_down_in_month, declined, escalated, weaponised, weaponised_ever, weaponised_after_decline, re_taken_down, alert_ids, frozen_at";

/**
 * The month's TARGETED brands, every page of them.
 *
 * `clones > 0`: since v325 the store also holds a zero row for every brand we
 * watched and found nothing for (the honest "0 this month, and we were
 * looking"). The stewardship ledger reports brands that were targeted, so a
 * zero row must not become a report — it would read as an empty report card.
 *
 * Paginated (was one `.range(0, 999)` page plus a throw at 1,000): the zero
 * rows put the month at ~watchlist size, and PostgREST caps every response at
 * 1,000 rows, so a single page is a ceiling we would now hit by growth alone.
 */
export async function readMonthlyBrandStore(
  sb: ServiceClient,
  periodMonth: string, // "YYYY-MM-01"
): Promise<LedgerStoreRow[]> {
  const { rows, error } = await fetchAllRows<LedgerStoreRow>((from, to) =>
    sb
      .from("clone_watch_monthly_brand_stats")
      .select(LEDGER_SELECT)
      .eq("period_month", periodMonth)
      .gt("clones", 0)
      // `.order` is load-bearing: a .range() walk over an unordered query can
      // skip and repeat rows between pages.
      .order("brand", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: LedgerStoreRow[] | null;
      error: { message: string } | null;
    }>,
  );
  if (error) throw new Error(`monthly store read failed: ${error.message}`);
  return rows;
}

/**
 * The ledger's `metrics.clones` for one brand: COUNTS from the store (the
 * published month, frozen), the per-lookalike watch-list and breakdown bars
 * from the member alerts' CURRENT state (`detail` = aggregateClonesByDomain
 * over exactly the store's alert_ids — the watch-list is "what is live now",
 * and the email says so).
 *
 * Why the detail stays a fold of member alerts rather than a store column: it
 * is presentation (screenshot URLs, risk scores, still-live stamps) for one
 * reader, and freezing it would make the watch-list stale by design. What the
 * store removes is the second answer to "who counts" and "how many".
 */
export function ledgerCloneMetrics(
  store: LedgerStoreRow,
  detail: CloneBrandMetrics | undefined,
): Record<string, unknown> {
  return {
    detected: store.clones,
    netcraft_reported: store.reported_to_netcraft,
    taken_down: store.taken_down,
    taken_down_in_month: store.taken_down_in_month,
    declined: store.declined,
    escalated: store.escalated,
    weaponised: store.weaponised,
    weaponised_ever: store.weaponised_ever,
    weaponised_after_decline: store.weaponised_after_decline ?? 0,
    re_taken_down: store.re_taken_down ?? 0,
    top_risk: topRiskUnactioned(detail?.domains ?? []),
    by_classification: detail?.byClassification ?? {},
    by_country: detail?.byCountry ?? {},
    by_registrar: detail?.byRegistrar ?? {},
    by_asn: detail?.byAsn ?? {},
    domains: detail?.domains ?? [],
    alert_ids: store.alert_ids ?? [],
    // Which published version of the month these counts came from.
    store_frozen_at: store.frozen_at,
  };
}
