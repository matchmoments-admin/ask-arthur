import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { logCost } from "@/lib/cost-telemetry";

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
    concurrency: { limit: 1 },
  },
  // Two triggers: cron + manual-trigger event for ad-hoc rerun.
  // Sun 10:00 UTC — deconflicted from the daily feedback-digest cron
  // (0 9 * * *, every morning including Sundays). Closes ultrareview M3.
  [
    { cron: "0 10 * * 0" },
    { event: "shopfront/clone.weekly-digest.manual-trigger.v1" },
  ],
  async ({ step }) => {
    if (!featureFlags.shopfrontCloneOutreach) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
    }
    if (!featureFlags.shopfrontCloneWeeklyDigest) {
      return {
        skipped: true,
        reason: "FF_SHOPFRONT_CLONE_WEEKLY_DIGEST disabled",
      };
    }

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
        return EMPTY_TAKEDOWN_STATS;
      }
      if (!Array.isArray(data) || data.length === 0) {
        return EMPTY_TAKEDOWN_STATS;
      }
      const r = data[0] as Record<string, number>;
      return {
        takedowns_total: Number(r.takedowns_total ?? 0),
        median_minutes: Number(r.median_minutes ?? 0),
        p90_minutes: Number(r.p90_minutes ?? 0),
      };
    });

    const brandBreakdown = await step.run("fetch-brand-breakdown", async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: rows } = await sb
        .from("shopfront_clone_alerts")
        .select("inferred_target_domain, triage_status")
        .eq("source", "nrd")
        .gte("first_seen_at", since)
        .in("triage_status", ["tp_confirmed", "tp_actioned"]);
      const counts = new Map<string, number>();
      for (const row of rows ?? []) {
        const brand = (row as { inferred_target_domain: string })
          .inferred_target_domain;
        counts.set(brand, (counts.get(brand) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([brand, count]) => ({ brand, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    });

    // PR-B Phase 1: surface low-severity queue rows in the admin digest
    // so the operator can see what notify-brand has been suppressing.
    // (The actual brand-consolidated weekly digest send is a follow-up;
    // for now these rows accumulate in 'pending' status and the admin
    // sees per-brand counts here.)
    const lowSeverityDigest = await step.run("fetch-low-severity-queue", async () => {
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
    });

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
      takedown,
    });

    const telegramMessage = buildTelegramMessage({
      period,
      metrics,
      tpRate,
      fpRate,
      brandBreakdown,
      linkedinDraft,
      takedown,
      lowSeverityDigest,
    });

    await step.run("send-telegram", async () => {
      await sendAdminTelegramMessage(telegramMessage);
    });

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_weekly_digest",
        provider: "telegram",
        operation: "weekly_digest_send",
        units: 1,
        unitCostUsd: 0,
        metadata: {
          period,
          candidates_total: metrics.candidates_total,
          triaged_tp: metrics.triaged_tp,
          brands_touched: metrics.brands_touched,
        },
      });
    });

    logger.info("clone-watch weekly digest sent", {
      period,
      candidates: metrics.candidates_total,
      tp: metrics.triaged_tp,
    });

    return { ok: true, period, metrics };
  },
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

export interface TakedownStats {
  takedowns_total: number;
  median_minutes: number;
  p90_minutes: number;
}

const EMPTY_TAKEDOWN_STATS: TakedownStats = {
  takedowns_total: 0,
  median_minutes: 0,
  p90_minutes: 0,
};

function formatMinutes(m: number): string {
  if (!m || m < 1) return "—";
  if (m < 60) return `${m} min`;
  return `${(m / 60).toFixed(1)}h`;
}

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
  linkedinDraft,
  takedown,
  lowSeverityDigest,
}: {
  period: string;
  metrics: WeeklyMetrics;
  tpRate: number;
  fpRate: number;
  brandBreakdown: Array<{ brand: string; count: number }>;
  linkedinDraft: string;
  takedown?: TakedownStats;
  lowSeverityDigest?: LowSeverityDigest;
}): string {
  const brandLines = brandBreakdown.length
    ? brandBreakdown.map((b) => `· ${escapeHtml(b.brand)} — ${b.count}`).join("\n")
    : "<i>(no confirmed TPs this week)</i>";

  const takedownLine =
    takedown && takedown.takedowns_total > 0
      ? `Netcraft takedowns: <b>${takedown.takedowns_total}</b> · median <b>${formatMinutes(takedown.median_minutes)}</b> · P90 ${formatMinutes(takedown.p90_minutes)}`
      : `Netcraft takedowns: 0 (polling cron warming up)`;

  const lowSeverityLines =
    lowSeverityDigest && lowSeverityDigest.total > 0
      ? [
          ``,
          `<b>Low-severity queue (suppressed from per-hit email):</b>`,
          `<i>${lowSeverityDigest.total} candidates across ${lowSeverityDigest.byBrand.length} brand(s)</i>`,
          ...lowSeverityDigest.byBrand.map(
            (b) => `· ${escapeHtml(b.brand)} — ${b.count}`,
          ),
        ]
      : [];

  return [
    `🛡️ <b>Clone-watch weekly · ${escapeHtml(period)}</b>`,
    ``,
    `Candidates: <b>${metrics.candidates_total}</b>`,
    `TP confirmed: <b>${metrics.triaged_tp}</b> (${tpRate}%)`,
    `FP: <b>${metrics.triaged_fp}</b> (${fpRate}%)`,
    `Investigate: ${metrics.triaged_investigate}`,
    `Pending: ${metrics.pending}`,
    `Brands touched: <b>${metrics.brands_touched}</b>`,
    `Netcraft submits: ${metrics.submissions_netcraft}`,
    takedownLine,
    `Brand notifications: ${metrics.notifications_sent}`,
    ``,
    `<b>Top brands (confirmed TP):</b>`,
    brandLines,
    ...lowSeverityLines,
    ``,
    `<b>Triage queue:</b> <a href="https://askarthur.au/admin/clone-watch">askarthur.au/admin/clone-watch</a>`,
    ``,
    `<b>LinkedIn-post draft (copy-paste):</b>`,
    ``,
    `<pre>${escapeHtml(linkedinDraft)}</pre>`,
  ].join("\n");
}

export function buildLinkedInDraft({
  period,
  metrics,
  brandBreakdown,
  takedown,
}: {
  period: string;
  metrics: WeeklyMetrics;
  brandBreakdown: Array<{ brand: string; count: number }>;
  takedown?: TakedownStats;
}): string {
  const brandLine = brandBreakdown
    .slice(0, 5)
    .map((b) => brandDisplayName(b.brand))
    .join(", ");

  const takedownLine =
    takedown && takedown.takedowns_total > 0
      ? `${takedown.takedowns_total} domains browser-blocked via Netcraft — median time-to-takedown ${formatMinutes(takedown.median_minutes)}.`
      : null;

  return [
    `🛡️ Ask Arthur clone-watch — week of ${period}`,
    ``,
    `${metrics.candidates_total} candidate clone domains surfaced across ${metrics.brands_touched} Australian brands.`,
    `${metrics.triaged_tp} confirmed as likely clones after human review.`,
    `${metrics.submissions_netcraft} submitted to community blocklists for browser-block coverage.`,
    ...(takedownLine ? [takedownLine] : []),
    `${metrics.notifications_sent} brand security teams notified.`,
    ``,
    brandLine
      ? `Most targeted this week: ${brandLine}.`
      : `Quiet week — no confirmed clones.`,
    ``,
    `Every newly-registered .com / .shop / .net domain is matched against our 50-entry AU brand watchlist each morning. When we spot something — typosquats, unicode look-alikes, brand-string substrings — we submit it for community blocklist coverage and let the brand know directly.`,
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
