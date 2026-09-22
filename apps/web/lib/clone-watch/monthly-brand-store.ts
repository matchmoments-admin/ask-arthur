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
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import {
  topRiskUnactioned,
  type CloneBrandMetrics,
} from "@/lib/clone-watch/clone-metrics";
import type { MonthWindow } from "@/lib/clone-watch/month-window";
import type { CloneWatchTrendRows } from "@/lib/clone-watch/report-card";

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

export async function readMonthlyBrandStore(
  sb: ServiceClient,
  periodMonth: string, // "YYYY-MM-01"
): Promise<LedgerStoreRow[]> {
  // ~150 rows a month; one page is plenty, but say so if that ever changes.
  const { data, error } = await sb
    .from("clone_watch_monthly_brand_stats")
    .select(LEDGER_SELECT)
    .eq("period_month", periodMonth)
    .order("brand", { ascending: true })
    .range(0, 999);
  if (error) throw new Error(`monthly store read failed: ${error.message}`);
  const rows = (data ?? []) as LedgerStoreRow[];
  if (rows.length >= 1000) {
    throw new Error(`monthly store read truncated: ${periodMonth} has ≥1000 brand rows`);
  }
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
