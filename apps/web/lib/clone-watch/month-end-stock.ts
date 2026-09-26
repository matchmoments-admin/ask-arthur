/**
 * Month-end stock — which lookalikes are still up when a month closes (v325).
 *
 * The monthly store counted a FLOW (lookalikes first seen in the month) and
 * nothing measured the STOCK a brand faces: the squats from every earlier
 * month that are still registered, parked or serving. This Module is the
 * logic behind `clone-watch-month-end-liveness`, split from the Inngest
 * function so the selection and the chunk walk are testable with a stubbed
 * resolver:
 *
 *   - `selectActiveStock` — which alerts are stock (pure);
 *   - `probeChunk` — DNS-probe one chunk under an in-step budget and turn each
 *     answer into a snapshot row through `stockStatus` (the ONE rule, in
 *     clone-metrics.ts);
 *   - `unprobedSnapshot` — the honest row for a domain the run never reached.
 *
 * The status rule is NOT here: it lives beside `squatStatus` so the two
 * readings of "what is this lookalike now" share one home.
 */
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import {
  AUDIT_SAMPLE_EMBED,
  isAuditWithheld,
  type AuditSampleEmbed,
} from "@/lib/clone-watch/clone-cohort";
import { TERMINAL_STATES } from "@/lib/clone-watch/lifecycle";
import {
  classifyHostLookups,
  type DnsLookup,
} from "@/lib/clone-watch/liveness";
import {
  stockStatus,
  type StockDns,
  type StockStatus,
} from "@/lib/clone-watch/clone-metrics";

/** DNS queries in flight per chunk. Each costs ~ms; a slow one caps at 4 s. */
export const STOCK_PROBE_CONCURRENCY = 16;

/** The columns `selectActiveStock` needs. */
export interface StockCandidate {
  id: number;
  candidate_domain: string | null;
  inferred_target_domain: string | null;
  lifecycle_state: string | null;
  triage_status: string | null;
}

/**
 * Active stock: every NRD lookalike still in play — not taken down, not
 * dormant (TERMINAL_STATES), not triaged fp, not a denylisted generic brand —
 * counted once per candidate domain (lowest id wins, so re-runs pick the same
 * alert). Returns alert ids, ascending.
 *
 * The caller has already restricted to `source = 'nrd'`, a non-null brand and
 * `first_seen_at` before the month's end (a squat registered after the month
 * closed is not that month's stock).
 */
export function selectActiveStock(rows: readonly StockCandidate[]): number[] {
  const terminal = new Set<string>(TERMINAL_STATES);
  const seen = new Set<string>();
  const out: number[] = [];
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const domain = r.candidate_domain?.trim().toLowerCase();
    if (!domain) continue; // nothing to probe
    if (r.triage_status === "fp") continue;
    if (r.lifecycle_state && terminal.has(r.lifecycle_state)) continue;
    if (!r.inferred_target_domain || isFpBrand(r.inferred_target_domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(r.id);
  }
  return out;
}

/** The columns a probe chunk reads per alert. */
export interface StockRow {
  id: number;
  candidate_domain: string;
  inferred_target_domain: string;
  attribution: unknown;
  urlscan_classification: string | null;
  lifecycle_state: string | null;
  urlscan_uuid: string | null;
  urlscan_failure_streak: number | null;
  urlscan_evidence: { status?: unknown } | null;
  /** Read only by `isAuditWithheld` (clone-cohort.ts, #1256). */
  clone_watch_classifications?: { is_clone: boolean | null } | null;
  clone_watch_not_a_clone_samples?: AuditSampleEmbed;
}

// The two embeds exist only for `isAuditWithheld` (#1256). Without them, a
// not-a-clone audit sample's parked_for_sale verdict would move it from `live`
// to `parked` in the brand's persisted stock split.
export const STOCK_ROW_SELECT =
  "id, candidate_domain, inferred_target_domain, attribution, urlscan_classification, lifecycle_state, urlscan_uuid, urlscan_failure_streak, urlscan_evidence, clone_watch_classifications(is_clone), " +
  AUDIT_SAMPLE_EMBED;

/** One clone_liveness_snapshots row. */
export interface SnapshotInsert {
  period_month: string;
  alert_id: number;
  candidate_domain: string;
  brand: string;
  status: StockStatus;
  dns: Record<string, unknown>;
  checked_at: string;
}

/**
 * The v326 dead-dormancy rule (#1240): urlscan refused the name as
 * unresolvable eight times running, so the recheck worklist stopped offering
 * it. TS twin of the predicate `reset_clone_alert_dead_dormancy` re-checks in
 * SQL (v325) — the SQL is authoritative; this only decides whom to ask about.
 */
export function isDeadDormant(
  row: Pick<StockRow, "urlscan_uuid" | "urlscan_failure_streak" | "urlscan_evidence">,
): boolean {
  return (
    row.urlscan_uuid == null &&
    (row.urlscan_failure_streak ?? 0) >= 8 &&
    String(row.urlscan_evidence?.status ?? "") === "400"
  );
}

/** Compact, jsonb-safe record of the answers (records, or the error code). */
function dnsRecord(dns: StockDns): Record<string, unknown> {
  const one = (l: DnsLookup | null) =>
    l === null ? null : "records" in l ? l.records : { error: l.errorCode };
  return { a: one(dns.a), aaaa: one(dns.aaaa), ns: one(dns.ns) };
}

/** The honest row for a domain the run never probed. */
export function unprobedSnapshot(
  row: Pick<StockRow, "id" | "candidate_domain" | "inferred_target_domain">,
  periodMonth: string,
  checkedAt: string,
): SnapshotInsert {
  return {
    period_month: periodMonth,
    alert_id: row.id,
    candidate_domain: row.candidate_domain,
    brand: row.inferred_target_domain.trim().toLowerCase(),
    status: "unverified",
    dns: { reason: "not_probed" },
    checked_at: checkedAt,
  };
}

export interface ProbeChunkResult {
  snapshots: SnapshotInsert[];
  /**
   * How many ids of the chunk, IN ORDER, were handled. The run's next chunk
   * starts at `offset + handled`, so a budget-cut chunk carries its unprobed
   * tail forward instead of dropping it. A prefix by construction: once the
   * budget expires no worker picks up a new id, and ids are picked in order.
   */
  handled: number;
  /** Dead-dormant (v326) rows whose name now resolves to a host. */
  dormantResolving: number[];
}

/**
 * Probe one chunk of ids. `ids` is the chunk's slice of the run's id list;
 * `rows` is what the database returned for it (an id with no row — deleted
 * since the load — is handled and skipped). Never throws for one domain: a
 * probe that fails is `unverified`, the same as a resolver that proved nothing.
 */
export async function probeChunk(input: {
  ids: readonly number[];
  rows: readonly StockRow[];
  periodMonth: string;
  probe: (hostname: string) => Promise<StockDns | null>;
  expired: () => boolean;
  now?: () => Date;
  concurrency?: number;
}): Promise<ProbeChunkResult> {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const now = input.now ?? (() => new Date());
  const results: Array<SnapshotInsert | "skip" | null> = new Array(
    input.ids.length,
  ).fill(null);
  const dormantResolving: number[] = [];

  await mapWithConcurrency(
    input.ids.map((id, i) => ({ id, i })),
    input.concurrency ?? STOCK_PROBE_CONCURRENCY,
    async ({ id, i }) => {
      if (input.expired()) return; // leaves results[i] null → not handled
      const row = byId.get(id);
      if (!row) {
        results[i] = "skip";
        return;
      }
      let dns: StockDns | null = null;
      try {
        dns = await input.probe(row.candidate_domain);
      } catch {
        dns = null;
      }
      // #1256: a not-a-clone audit sample's verdict is not a fact about the
      // brand, so the stock status reads only DNS and attribution for it. The
      // mask is narrowed to the status input on purpose. `isDeadDormant` below
      // reads urlscan_evidence as operational state, not as a brand count.
      const status = stockStatus({
        dns,
        attribution: row.attribution,
        urlscan_classification: isAuditWithheld(row)
          ? null
          : row.urlscan_classification,
        lifecycle_state: row.lifecycle_state,
      });
      if (
        dns &&
        isDeadDormant(row) &&
        classifyHostLookups(dns.a, () => dns.aaaa ?? { errorCode: "UNKNOWN" }) === true
      ) {
        dormantResolving.push(row.id);
      }
      results[i] = {
        period_month: input.periodMonth,
        alert_id: row.id,
        candidate_domain: row.candidate_domain,
        brand: row.inferred_target_domain.trim().toLowerCase(),
        status,
        dns: dns ? dnsRecord(dns) : { reason: "resolver_unavailable" },
        checked_at: now().toISOString(),
      };
    },
  );

  let handled = 0;
  while (handled < results.length && results[handled] !== null) handled++;
  const snapshots = results
    .slice(0, handled)
    .filter((r): r is SnapshotInsert => r !== null && r !== "skip");
  return {
    snapshots,
    handled,
    dormantResolving: dormantResolving
      .filter((id) => snapshots.some((s) => s.alert_id === id))
      .sort((a, b) => a - b),
  };
}
