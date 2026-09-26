import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { laneGate } from "@/lib/laneHealth";
import { html, joinHtml, type SafeHtml } from "@askarthur/utils/html";
import {
  formatDurationMinutes,
  parseTakedownStats,
  publishableMedian,
  type TakedownStats,
} from "@/lib/clone-watch/takedown-stats";
import { MEDIAN_FLOOR } from "@/lib/clone-watch/duration-kpis";

/**
 * Layer 5 — weekly digest of clone-watch activity. Cron Sun 09:00 UTC
 * (after the daily NRD ingest and triage have settled).
 *
 * Produces two artefacts:
 *   1. Telegram message to admin chat — operator KPIs, raw numbers.
 *   2. Markdown LinkedIn-post draft embedded in that message — admin
 *      copy-pastes to LinkedIn (or X, Mastodon, etc).
 *
 * The LinkedIn draft is anonymised by design — no specific candidate domain
 * names appear in the post body. We name the BRANDS that were targeted +
 * the aggregate numbers (browser-blocks confirmed, median takedown time).
 * Operator naming is the lawyer-pack territory and explicitly out of scope.
 *
 * Gated by FF_SHOPFRONT_CLONE_WEEKLY_DIGEST. Skips silently when off.
 *
 * See docs/plans/clone-watch-outreach.md §9 Phase 5.
 */
export const cloneWatchWeeklyDigest = inngest.createFunction(
  {
    id: "shopfront-clone-weekly-digest",
    name: "Clone-Watch: Weekly digest + LinkedIn-post draft",
    retries: 2,
    // ADR-0019's circuit breaker, absent until #1139. 7 static step.run
    // sites, none interpolated: 7 x 30s queue wait + 60s slack = 270s. The
    // three `for` loops inside the fetch steps iterate rows already in
    // memory to build aggregates — no await per row, so no inline
    // wall-clock budget is needed and no spanning-budget replay hazard
    // exists (#1138). Declared 6m (360s), clear of the 4.5m floor.
    timeouts: { finish: "6m" },
    concurrency: { limit: 1 },
  },
  // Manual-trigger only (no cron). FF_SHOPFRONT_CLONE_WEEKLY_DIGEST is dark
  // in prod, so the weekly tick just burned an execution to early-return
  // (fleet audit 2026-09-16). Invoke on demand via the
  // `shopfront/clone.weekly-digest.manual-trigger.v1` event. **At launch,
  // restore by re-adding `...laneCrons("shopfront-clone-weekly-digest")`**
  // alongside this event trigger — Sun 10:00 UTC (declared in LANE_SHAPES),
  // deconflicted from the daily feedback-digest cron (0 9 * * *) per
  // ultrareview M3.
  { event: "shopfront/clone.weekly-digest.manual-trigger.v1" },
  withAxiomLogging(
    { fnId: "shopfront-clone-weekly-digest" },
    async ({ step }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-weekly-digest");
      if (!gate.ok) return { skipped: true, reason: gate.reason };

      const sb = createServiceClient();
      if (!sb) {
        return { skipped: true, reason: "supabase_unavailable" };
      }

      const metrics = await step.run("fetch-weekly-metrics", async () => {
        const { data, error } = await sb.rpc("clone_watch_weekly_metrics", {
          p_days: 7,
        });
        if (error) throw new Error(`weekly-metrics rpc: ${error.message}`);
        if (!Array.isArray(data) || data.length === 0) {
          return EMPTY_METRICS;
        }
        const r = data[0] as Record<string, number>;
        return {
          candidates_total: Number(r.candidates_total ?? 0),
          triaged_tp: Number(r.triaged_tp ?? 0),
          triaged_fp: Number(r.triaged_fp ?? 0),
          triaged_investigate: Number(r.triaged_investigate ?? 0),
          pending: Number(r.pending ?? 0),
          brands_touched: Number(r.brands_touched ?? 0),
          submissions_netcraft: Number(r.submissions_netcraft ?? 0),
          notifications_sent: Number(r.notifications_sent ?? 0),
        };
      });

      const takedown = await step.run("fetch-takedown-stats", async () => {
        const { data, error } = await sb.rpc("clone_watch_takedown_stats", {
          p_days: 7,
        });
        // Don't fail the digest on takedown-stats failure — it's a nice-to-have
        // KPI, not the primary signal. Log so we don't silently lose it.
        // Closes ultrareview I2.
        if (error) {
          logger.error("clone-watch weekly digest: takedown stats failed", {
            error: error.message,
          });
          return null;
        }
        // One reader (lib/clone-watch/takedown-stats.ts): a null latency is
        // "not measured", never "0 min" (#1234).
        return parseTakedownStats(data);
      });

      const brandBreakdown = await step.run(
        "fetch-brand-breakdown",
        async () => {
          const since = new Date(Date.now() - 7 * 86400000).toISOString();
          // The comment that used to sit here named the 1000-row cap correctly and
          // then defended against it with `.limit(2000)` + a `=== 2000` guard —
          // both above the ceiling, so the cap still applied and the guard could
          // never fire. Paginating is the actual defence.
          const { rows, truncated } = await fetchAllRows<{
            inferred_target_domain: string;
            triage_status: string;
          }>(
            (from, to) =>
              sb
                .from("shopfront_clone_alerts")
                .select("inferred_target_domain, triage_status")
                .eq("source", "nrd")
                .gte("first_seen_at", since)
                .in("triage_status", ["tp_confirmed", "tp_actioned"])
                .order("id", { ascending: true })
                .range(from, to) as unknown as PromiseLike<{
                data: Array<{
                  inferred_target_domain: string;
                  triage_status: string;
                }> | null;
                error: { message: string } | null;
              }>,
            { maxRows: 20_000 },
          );
          if (truncated) {
            logger.warn(
              "clone-watch weekly-digest: brand-breakdown hit row cap",
            );
          }
          const counts = new Map<string, number>();
          for (const row of rows) {
            const brand = (row as { inferred_target_domain: string })
              .inferred_target_domain;
            counts.set(brand, (counts.get(brand) ?? 0) + 1);
          }
          return Array.from(counts.entries())
            .map(([brand, count]) => ({ brand, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
        },
      );

      // Brands we actually reported to this week (i.e. brand_notification
      // status = 'sent' in submitted_to JSONB). Distinct from
      // brandBreakdown — that's confirmed TPs, which may include brands
      // routed to manual_review / none / VDP channels where we don't send
      // an email. This list is the public "we cooperated with these
      // security teams" signal.
      const reportedBrands = await step.run(
        "fetch-reported-brands",
        async () => {
          const since = new Date(Date.now() - 7 * 86400000).toISOString();
          const { rows, truncated } = await fetchAllRows<{
            inferred_target_domain: string;
            submitted_to: unknown;
          }>(
            (from, to) =>
              sb
                .from("shopfront_clone_alerts")
                .select("inferred_target_domain, submitted_to")
                .eq("source", "nrd")
                .gte("first_seen_at", since)
                .not("submitted_to->brand_notification->status", "is", null)
                .order("id", { ascending: true })
                .range(from, to) as unknown as PromiseLike<{
                data: Array<{
                  inferred_target_domain: string;
                  submitted_to: unknown;
                }> | null;
                error: { message: string } | null;
              }>,
            { maxRows: 20_000 },
          );
          if (truncated) {
            logger.warn(
              "clone-watch weekly-digest: reported-brands hit row cap",
            );
          }
          const brands = new Set<string>();
          for (const row of rows) {
            const r = row as {
              inferred_target_domain: string;
              submitted_to: Record<string, unknown> | null;
            };
            const status = (
              r.submitted_to?.brand_notification as
                | { status?: string }
                | undefined
            )?.status;
            if (status === "sent") {
              brands.add(r.inferred_target_domain);
            }
          }
          return Array.from(brands).sort();
        },
      );

      // PR-B Phase 1: surface low-severity queue rows in the admin digest
      // so the operator can see what notify-brand has been suppressing.
      // (The actual brand-consolidated weekly digest send is a follow-up;
      // for now these rows accumulate in 'pending' status and the admin
      // sees per-brand counts here.)
      const lowSeverityDigest = await step.run(
        "fetch-low-severity-queue",
        async () => {
          const { data: rows } = await sb.rpc(
            "list_clone_alerts_pending_notification_batch",
            { p_severity: "low", p_limit: 500 },
          );
          const counts = new Map<string, number>();
          for (const row of (rows ?? []) as Array<{ brand: string }>) {
            counts.set(row.brand, (counts.get(row.brand) ?? 0) + 1);
          }
          return {
            total: rows?.length ?? 0,
            byBrand: Array.from(counts.entries())
              .map(([brand, count]) => ({ brand, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5),
          };
        },
      );

      const weekEnd = new Date();
      const weekStart = new Date(Date.now() - 7 * 86400000);
      const formatDate = (d: Date) =>
        d.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
        });
      const period = `${formatDate(weekStart)} – ${formatDate(weekEnd)}`;

      const tpRate =
        metrics.candidates_total > 0
          ? Math.round((metrics.triaged_tp / metrics.candidates_total) * 100)
          : 0;
      const fpRate =
        metrics.candidates_total > 0
          ? Math.round((metrics.triaged_fp / metrics.candidates_total) * 100)
          : 0;

      const linkedinDraft = buildLinkedInDraft({
        period,
        metrics,
        brandBreakdown,
        reportedBrands,
        takedown,
      });

      const telegramMessage = buildTelegramMessage({
        period,
        metrics,
        tpRate,
        fpRate,
        brandBreakdown,
        reportedBrands,
        linkedinDraft,
        takedown,
        lowSeverityDigest,
      });

      await step.run("send-telegram", async () => {
        await sendAdminTelegramMessage(telegramMessage);
      });

      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-weekly-digest", 1, {
          period,
          candidates_total: metrics.candidates_total,
          triaged_tp: metrics.triaged_tp,
          brands_touched: metrics.brands_touched,
        }),
      );

      logger.info("clone-watch weekly digest sent", {
        period,
        candidates: metrics.candidates_total,
        tp: metrics.triaged_tp,
      });

      return { ok: true, period, metrics };
    },
  ),
);

export interface WeeklyMetrics {
  candidates_total: number;
  triaged_tp: number;
  triaged_fp: number;
  triaged_investigate: number;
  pending: number;
  brands_touched: number;
  submissions_netcraft: number;
  notifications_sent: number;
}

const EMPTY_METRICS: WeeklyMetrics = {
  candidates_total: 0,
  triaged_tp: 0,
  triaged_fp: 0,
  triaged_investigate: 0,
  pending: 0,
  brands_touched: 0,
  submissions_netcraft: 0,
  notifications_sent: 0,
};

export interface LowSeverityDigest {
  total: number;
  byBrand: Array<{ brand: string; count: number }>;
}

export function buildTelegramMessage({
  period,
  metrics,
  tpRate,
  fpRate,
  brandBreakdown,
  reportedBrands,
  linkedinDraft,
  takedown,
  lowSeverityDigest,
}: {
  period: string;
  metrics: WeeklyMetrics;
  tpRate: number;
  fpRate: number;
  brandBreakdown: Array<{ brand: string; count: number }>;
  reportedBrands: string[];
  linkedinDraft: string;
  takedown?: TakedownStats | null;
  lowSeverityDigest?: LowSeverityDigest;
}): SafeHtml {
  const brandLines = brandBreakdown.length
    ? joinHtml(
        brandBreakdown.map((b) => html`· ${b.brand} — ${b.count}`),
        "\n",
      )
    : html`<i>(no confirmed TPs this week)</i>`;

  const reportedLine =
    reportedBrands.length > 0
      ? html`Reported directly to: <b>${reportedBrands.map((b) => brandDisplayName(b)).join(", ")}</b>`
      : html`Reported directly to: <i>(no direct-email channels fired this week)</i>`;

  // #1234: detection → blocklist (weaponised_at → Netcraft's own classification
  // time) and Netcraft's triage latency on its OWN clock. The old line
  // subtracted our submitted_at from Netcraft's time and read "median 0 min".
  // A null is a FAILED read (RPC error / no row), never "0 this week" — the
  // review found the old line printed a confident zero for an outage.
  const takedownLine = !takedown
    ? html`Netcraft blocklistings: <i>unavailable (stats read failed)</i>`
    : takedown.blocklisted > 0
      ? html`Netcraft blocklistings: <b>${takedown.blocklisted}</b> · detection→blocklist median <b>${formatDurationMinutes(takedown.detectToBlock?.median ?? null)}</b> (n=${takedown.detectToBlock?.n ?? 0}) · Netcraft triage ${formatDurationMinutes(takedown.triageMinutes?.median ?? null)} (n=${takedown.triageMinutes?.n ?? 0})`
      : html`Netcraft blocklistings: 0 this week`;

  const lowSeverityLines: SafeHtml[] =
    lowSeverityDigest && lowSeverityDigest.total > 0
      ? [
          html``,
          html`<b>Low-severity queue (suppressed from per-hit email):</b>`,
          html`<i>${lowSeverityDigest.total} candidates across ${lowSeverityDigest.byBrand.length} brand(s)</i>`,
          ...lowSeverityDigest.byBrand.map(
            (b) => html`· ${b.brand} — ${b.count}`,
          ),
        ]
      : [];

  return joinHtml(
    [
      html`🛡️ <b>Clone-watch weekly · ${period}</b>`,
      html``,
      html`Candidates: <b>${metrics.candidates_total}</b>`,
      html`TP confirmed: <b>${metrics.triaged_tp}</b> (${tpRate}%)`,
      html`FP: <b>${metrics.triaged_fp}</b> (${fpRate}%)`,
      html`Investigate: ${metrics.triaged_investigate}`,
      html`Pending: ${metrics.pending}`,
      html`Brands touched: <b>${metrics.brands_touched}</b>`,
      html`Netcraft submits: ${metrics.submissions_netcraft}`,
      takedownLine,
      html`Brand notifications: ${metrics.notifications_sent}`,
      reportedLine,
      html``,
      html`<b>Top brands (confirmed TP):</b>`,
      brandLines,
      ...lowSeverityLines,
      html``,
      html`<b>Triage queue:</b> <a href="https://askarthur.au/admin/clone-watch">askarthur.au/admin/clone-watch</a>`,
      html``,
      html`<b>LinkedIn-post draft (copy-paste):</b>`,
      html``,
      html`<pre>${linkedinDraft}</pre>`,
    ],
    "\n",
  );
}

export function buildLinkedInDraft({
  period,
  metrics,
  brandBreakdown,
  reportedBrands,
  takedown,
}: {
  period: string;
  metrics: WeeklyMetrics;
  brandBreakdown: Array<{ brand: string; count: number }>;
  reportedBrands: string[];
  takedown?: TakedownStats | null;
}): string {
  const targetedLine = brandBreakdown
    .slice(0, 5)
    .map((b) => brandDisplayName(b.brand))
    .join(", ");

  // Brands whose security teams we successfully emailed this week.
  // Distinct from "targeted" — that's brands seen in TPs. "Reported to"
  // is the cooperation signal we want to surface publicly.
  const reportedLine =
    reportedBrands.length > 0
      ? `Reported directly to security teams at: ${reportedBrands.map(brandDisplayName).join(", ")}.`
      : null;

  // A public draft: the same n >= MEDIAN_FLOOR bar as the public page.
  const blockMedian = publishableMedian(takedown?.detectToBlock ?? null, MEDIAN_FLOOR);
  const takedownLine =
    takedown && takedown.blocklisted > 0
      ? `${takedown.blocklisted} domains browser-blocked via Netcraft${
          blockMedian !== null
            ? ` — median ${formatDurationMinutes(blockMedian)} from our detecting live phishing to the blocklist`
            : ""
        } (classification, not offline).`
      : null;

  return [
    `🛡️ Ask Arthur clone-watch — week of ${period}`,
    ``,
    `${metrics.candidates_total} candidate clone domains surfaced across ${metrics.brands_touched} Australian brands.`,
    `${metrics.triaged_tp} confirmed as likely clones after human review.`,
    `${metrics.submissions_netcraft} submitted to community blocklists for browser-block coverage.`,
    ...(takedownLine ? [takedownLine] : []),
    ...(reportedLine ? [reportedLine] : []),
    ``,
    targetedLine
      ? `Most targeted this week: ${targetedLine}.`
      : `Quiet week — no confirmed clones.`,
    ``,
    `Every newly-registered .com / .shop / .net domain is matched against our 50-entry AU brand watchlist each morning. When we spot something — typosquats, unicode look-alikes, brand-string substrings — we submit it for community blocklist coverage and let the brand's security team know directly.`,
    ``,
    `Free, runs daily. If you want your brand added or you'd like the per-week feed for your security team: brendan@askarthur.au`,
    ``,
    `#scamprotection #cybersecurity #australia #brandprotection`,
  ].join("\n");
}

export function brandDisplayName(legitimateDomain: string): string {
  // Strip the TLD for readability in social copy: "kmart.com.au" → "Kmart"
  const root = legitimateDomain.split(".")[0] ?? legitimateDomain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

