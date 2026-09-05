// /admin/weekly-review — the Monday signal panel (#950, map #939).
//
// Renders the weekly-signal-review runbook's queries live (canary status
// incl. silent alerters, per-surface trailing-7d numbers, 7-day spend by
// feature) and persists one weekly_signal_log row per UTC-Monday week via
// the "Record this week" action — so the recording rule is automatic and
// the 6-week zero-movement trigger is computed, not remembered.
//
// docs/ops/weekly-signal-review.md stays the source of truth for query
// semantics; keep the two in sync when a surface's signal changes.
//
// Aggregation note: spend comes from the daily_cost_summary view (already
// day×feature aggregated) — summing raw cost_telemetry rows client-side
// would silently truncate at PostgREST's 1000-row cap (#941's own audit
// hit exactly that). Counts use { count: "exact", head: true }, which is
// not capped.

import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireAdmin, isAdminRequest } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  getScamTypeTrend,
  SCAM_TYPE_WINDOW_DAYS,
} from "@/lib/scam-type-trend";

export const dynamic = "force-dynamic";

interface CanaryRow {
  fired_at: string;
  condition_met: boolean;
  outcome: string | null;
  metadata: { silent?: string[] } | null;
}

interface LogRow {
  week_start: string;
  scans_forwarded: number;
  charity_checks: number;
  pageviews: number;
  subscribers_active: number;
  cache_hit_pct: number | null;
  spend_usd: number;
  notes: string | null;
  recorded_at: string;
}

/** UTC Monday (date string) of the week containing `now`. */
function utcMonday(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Wrapped so the impure Date.now() calls aren't made directly in the
// component render body — async Server Component runs once per request, so
// these are deterministic per response; the react-hooks/purity lint rule
// can't tell (same pattern as app/admin/costs/page.tsx and checks/page.tsx).
function trailing7dIso(): string {
  return new Date(Date.now() - 7 * 86400_000).toISOString();
}
function currentUtcMonday(): string {
  return utcMonday(new Date());
}

export default async function WeeklyReviewPage() {
  await requireAdmin();
  const svc = createServiceClient();
  if (!svc) {
    return <p className="p-8 text-sm text-gov-slate">Service client unavailable.</p>;
  }

  const sinceIso = trailing7dIso();
  const loadErrors: string[] = [];

  // Its own read rather than a member of the Promise.all below: it paginates
  // two tables across 56 days and returns a shaped result, not a PostgREST
  // response, so it does not fit the `[res, label]` error-check pattern the
  // others share.
  const scamTypes = await getScamTypeTrend();
  if (scamTypes.error) loadErrors.push("scam-type movement");

  const [
    canaryRes,
    scansRes,
    charityRes,
    pageviewsRes,
    subsActiveRes,
    subsBySourceRes,
    cacheHitRes,
    cacheMissRes,
    spendRes,
    logRes,
  ] = await Promise.all([
    svc
      .from("alert_delivery_log")
      .select("fired_at, condition_met, outcome, metadata")
      .eq("alerter", "alerting-canary")
      .order("fired_at", { ascending: false })
      .limit(1),
    svc
      .from("cost_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("feature", "inbound_scan")
      .gte("created_at", sinceIso),
    svc
      .from("cost_telemetry")
      .select("id", { count: "exact", head: true })
      .like("feature", "charity%")
      .gte("created_at", sinceIso),
    svc
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "pageview")
      .gte("created_at", sinceIso),
    svc
      .from("email_subscribers")
      .select("email", { count: "exact", head: true })
      .eq("is_active", true),
    svc
      .from("email_subscribers")
      .select("consent_source")
      .eq("is_active", true)
      .limit(1000),
    svc
      .from("scam_reports")
      .select("id", { count: "exact", head: true })
      .eq("analysis_result->>cacheHit", "true")
      .gte("created_at", sinceIso),
    svc
      .from("scam_reports")
      .select("id", { count: "exact", head: true })
      .eq("analysis_result->>cacheHit", "false")
      .gte("created_at", sinceIso),
    svc
      .from("daily_cost_summary")
      .select("day, feature, total_cost_usd")
      .gte("day", sinceIso.slice(0, 10)),
    svc
      .from("weekly_signal_log")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(12),
  ]);

  for (const [label, res] of [
    ["canary", canaryRes],
    ["forwarded scans", scansRes],
    ["charity checks", charityRes],
    ["pageviews", pageviewsRes],
    ["subscribers", subsActiveRes],
    ["subscriber sources", subsBySourceRes],
    ["cache hits", cacheHitRes],
    ["cache misses", cacheMissRes],
    ["spend", spendRes],
    ["weekly log", logRes],
  ] as const) {
    if (res.error) loadErrors.push(label);
  }

  const canary = (canaryRes.data?.[0] ?? null) as CanaryRow | null;
  const silent = canary?.metadata?.silent ?? [];
  const scansFwd = scansRes.count ?? 0;
  const charityChecks = charityRes.count ?? 0;
  const pageviews = pageviewsRes.count ?? 0;
  const subsActive = subsActiveRes.count ?? 0;
  const cacheHits = cacheHitRes.count ?? 0;
  const cacheMisses = cacheMissRes.count ?? 0;
  const cacheTotal = cacheHits + cacheMisses;
  const cacheHitPct = cacheTotal > 0 ? Math.round((cacheHits / cacheTotal) * 100) : null;

  const subsBySource = new Map<string, number>();
  for (const r of subsBySourceRes.data ?? []) {
    const k = (r.consent_source as string | null) ?? "(unknown)";
    subsBySource.set(k, (subsBySource.get(k) ?? 0) + 1);
  }

  const spendByFeature = new Map<string, number>();
  let spendTotal = 0;
  for (const r of spendRes.data ?? []) {
    const usd = Number(r.total_cost_usd ?? 0);
    spendByFeature.set(
      r.feature as string,
      (spendByFeature.get(r.feature as string) ?? 0) + usd,
    );
    spendTotal += usd;
  }
  const topSpend = [...spendByFeature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const log = (logRes.data ?? []) as LogRow[];
  const lastLogged = log[0] ?? null;
  const thisMonday = currentUtcMonday();
  const alreadyRecorded = log.some((r) => r.week_start === thisMonday);

  // 6-week zero-movement rule: a metric whose last 6 RECORDED values are
  // identical (or the log shows 6+ weeks of zeros) is a decision trigger,
  // not silence. Computed only once six rows exist.
  const zeroMovement: string[] = [];
  if (log.length >= 6) {
    const six = log.slice(0, 6);
    const flat = (pick: (r: LogRow) => number | null) => {
      const vals = six.map(pick);
      return vals.every((v) => v !== null && v === vals[0]);
    };
    if (flat((r) => r.scans_forwarded)) zeroMovement.push("forwarded scans");
    if (flat((r) => r.charity_checks)) zeroMovement.push("charity checks");
    if (flat((r) => r.pageviews)) zeroMovement.push("pageviews");
    if (flat((r) => r.subscribers_active)) zeroMovement.push("subscribers");
  }

  async function recordThisWeek() {
    "use server";
    if (!(await isAdminRequest())) throw new Error("admin_required");
    const sb = createServiceClient();
    if (!sb) throw new Error("service_client_unavailable");
    const { error } = await sb.from("weekly_signal_log").upsert(
      {
        week_start: thisMonday,
        scans_forwarded: scansFwd,
        charity_checks: charityChecks,
        pageviews,
        subscribers_active: subsActive,
        cache_hit_pct: cacheHitPct,
        spend_usd: Number(spendTotal.toFixed(4)),
      },
      { onConflict: "week_start" },
    );
    if (error) {
      logger.warn("weekly_signal_log_record_failed", { error: error.message });
      throw new Error("record_failed");
    }
    logger.warn("weekly_signal_log_recorded", { weekStart: thisMonday });
    revalidatePath("/admin/weekly-review");
  }

  const wow = (current: number, pick: (r: LogRow) => number): string => {
    if (!lastLogged) return "";
    const prev = pick(lastLogged);
    const delta = current - prev;
    return delta === 0 ? "±0 WoW" : `${delta > 0 ? "+" : ""}${delta} WoW`;
  };

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Weekly signal review</h1>
      <p className="text-gov-slate text-sm mb-6">
        The Monday rhythm, live. Semantics in{" "}
        <Link href="https://github.com/matchmoments-admin/ask-arthur/blob/main/docs/ops/weekly-signal-review.md" className="underline underline-offset-2">
          docs/ops/weekly-signal-review.md
        </Link>
        . Windows are trailing 7 days (UTC), except scam-type movement, which
        states its own.
      </p>

      {loadErrors.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Some queries failed</strong> — the zeros below them are NOT
          measurements: {loadErrors.join(", ")}.
        </div>
      )}

      {zeroMovement.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Zero movement for 6 recorded weeks:</strong> {zeroMovement.join(", ")} —
          per the recording rule this triggers a decision (change the
          distribution play, or mothball per NORTH_STAR), not another quiet week.
        </div>
      )}

      {/* 1. Canary */}
      <section className="mb-6 rounded-xl border border-border-light bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gov-slate mb-2">
          1 · Alerting canary
        </h2>
        {canary ? (
          <div className="text-sm text-deep-navy">
            Last heartbeat: {new Date(canary.fired_at).toLocaleString("en-AU")} ·
            outcome <code className="font-mono text-xs">{canary.outcome ?? "?"}</code>
            {silent.length > 0 ? (
              <p className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Silent alerters named: {silent.join("; ")} — investigate each
                before trusting a quiet week.
              </p>
            ) : (
              <p className="mt-2 text-emerald-700">No silent alerters named.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-red-700">
            No canary row found — the alerting fabric itself may be down.
          </p>
        )}
      </section>

      {/* 2. Surface signals */}
      <section className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Forwarded scans" value={scansFwd} note={wow(scansFwd, (r) => r.scans_forwarded)} />
        <Metric label="Charity checks" value={charityChecks} note={wow(charityChecks, (r) => r.charity_checks)} />
        <Metric label="Pageviews" value={pageviews} note={wow(pageviews, (r) => r.pageviews)} />
        <Metric label="Subscribers (active)" value={subsActive} note={wow(subsActive, (r) => r.subscribers_active)} />
      </section>

      <section className="mb-6 grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-light bg-white p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gov-slate mb-2">
            Subscribers by capture surface
          </h3>
          {subsBySource.size === 0 ? (
            <p className="text-sm text-gov-slate">None yet.</p>
          ) : (
            <ul className="text-sm text-deep-navy space-y-1">
              {[...subsBySource.entries()].map(([src, n]) => (
                <li key={src} className="flex justify-between">
                  <code className="font-mono text-xs">{src}</code>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-border-light bg-white p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gov-slate mb-2">
            Cache-served vs fresh analyses (7d)
          </h3>
          <p className="text-sm text-deep-navy">
            {cacheTotal === 0
              ? "No analyses in window."
              : `${cacheHits} cached / ${cacheMisses} fresh — ${cacheHitPct}% cache-hit`}
          </p>
        </div>
      </section>

      {/* 3. Spend */}
      <section className="mb-6 rounded-xl border border-border-light bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gov-slate mb-2">
          3 · Spend by feature (7d) — total ${spendTotal.toFixed(2)} USD
        </h2>
        <ul className="text-sm text-deep-navy space-y-1">
          {topSpend.map(([feature, usd]) => (
            <li key={feature} className="flex justify-between">
              <code className="font-mono text-xs">{feature}</code>
              <span className="tabular-nums">${usd.toFixed(4)}</span>
            </li>
          ))}
        </ul>
      </section>


      {/* 5. Scam types on the move */}
      <section className="mb-6 rounded-xl border border-border-light bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gov-slate mb-1">
          5 · Scam types on the move ({SCAM_TYPE_WINDOW_DAYS}d vs prior{" "}
          {SCAM_TYPE_WINDOW_DAYS}d)
        </h2>
        <p className="text-xs text-gov-slate mb-3">
          Both streams under one vocabulary — Reddit intel and submitted
          reports, whose raw labels disagree (<code className="font-mono">romance</code>{" "}
          vs <code className="font-mono">romance_scam</code>). Bucketed on{" "}
          <strong>when the scam was posted</strong>, not when we classified it,
          so a backfill cannot read as a wave. {SCAM_TYPE_WINDOW_DAYS} days
          rather than 7 because the smaller categories see only a handful of
          reports a week.
        </p>
        <p className="text-xs text-gov-slate mb-3">
          Volume for context — <strong>{scamTypes.movements.reduce((n, m) => n + m.recent, 0)}</strong>{" "}
          categorised in the recent window against{" "}
          <strong>{scamTypes.movements.reduce((n, m) => n + m.prior, 0)}</strong>{" "}
          before it. If those two differ a lot, every category moves with them
          and only the relative order is worth reading.
        </p>
        {scamTypes.movements.length === 0 ? (
          <p className="text-sm text-gov-slate">
            {scamTypes.error
              ? "Query failed — this is not a measurement."
              : "No categorised activity in either window."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gov-slate">
                <tr>
                  <th className="py-1.5 pr-3">Type</th>
                  <th className="py-1.5 pr-3 text-right">{SCAM_TYPE_WINDOW_DAYS}d</th>
                  <th className="py-1.5 pr-3 text-right">Prior</th>
                  <th className="py-1.5 pr-3 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {scamTypes.movements.map((m) => (
                  <tr key={m.type} className="border-t border-border-light">
                    <td className="py-1.5 pr-3 text-deep-navy">
                      {m.label}
                      {!m.readable && (
                        <span className="ml-2 text-xs text-slate-400">
                          too few to read
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{m.recent}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                      {m.prior}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        !m.readable
                          ? "text-slate-400"
                          : m.deltaPct === null
                            ? "text-deep-navy"
                            : m.deltaPct > 0
                              ? "text-red-700"
                              : "text-green-700"
                      }`}
                    >
                      {m.deltaPct === null
                        ? "new"
                        : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Record */}
      <section className="mb-6 rounded-xl border border-border-light bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gov-slate mb-2">
          4 · The recording rule
        </h2>
        <form action={recordThisWeek}>
          <button
            type="submit"
            className="px-4 py-2 bg-deep-navy text-white text-sm font-medium rounded-lg hover:bg-navy transition-colors"
          >
            {alreadyRecorded
              ? `Re-record week of ${thisMonday} (overwrites)`
              : `Record week of ${thisMonday}`}
          </button>
        </form>
        {log.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gov-slate">
                <tr>
                  <th className="py-1.5 pr-3">Week</th>
                  <th className="py-1.5 pr-3 text-right">Scans</th>
                  <th className="py-1.5 pr-3 text-right">Charity</th>
                  <th className="py-1.5 pr-3 text-right">Views</th>
                  <th className="py-1.5 pr-3 text-right">Subs</th>
                  <th className="py-1.5 pr-3 text-right">Cache %</th>
                  <th className="py-1.5 text-right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.week_start} className="border-t border-border-light tabular-nums">
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.week_start}</td>
                    <td className="py-1.5 pr-3 text-right">{r.scans_forwarded}</td>
                    <td className="py-1.5 pr-3 text-right">{r.charity_checks}</td>
                    <td className="py-1.5 pr-3 text-right">{r.pageviews}</td>
                    <td className="py-1.5 pr-3 text-right">{r.subscribers_active}</td>
                    <td className="py-1.5 pr-3 text-right">{r.cache_hit_pct ?? "—"}</td>
                    <td className="py-1.5 text-right">${Number(r.spend_usd).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gov-slate">
        Pointers: NORTH_STAR.md signals · docs/inngest-brakes.md · the #903
        waits list. Plausible (clone-watch/theme organics) stays external.
      </p>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-border-light bg-white p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-deep-navy tabular-nums">{value}</p>
      {note ? <p className="text-xs text-gov-slate mt-0.5">{note}</p> : null}
    </div>
  );
}
