import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import StatTopCard, { type StatTone } from "@/components/admin/overview/StatTopCard";
import OverviewTile from "@/components/admin/overview/OverviewTile";

export const dynamic = "force-dynamic";

// Admin overview / landing page. Surfaces today's cost spend, the open
// feedback queue, any paused cost brakes, and a tile per sub-page with
// one freshness metric — enough to decide where to drill down without
// burning a second click on a half-loaded data view.

interface Summary {
  todayCostUsd: number;
  todayCostEventCount: number;
  feedbackOpen: number;
  brakesPaused: number;
  costThresholdUsd: number;
}

interface TileMetric {
  href: string;
  title: string;
  purpose: string;
  metric: string;
  metricLabel: string;
  warn?: boolean;
  secondary?: string;
}

const ALL_INBOUND_SLUGS = [
  "inbound_scamwatch",
  "inbound_acsc",
  "inbound_austrac",
  "inbound_oaic",
  "inbound_afp",
  "inbound_acma",
  "inbound_idcare",
  "inbound_auscert",
  "inbound_ftc",
  "inbound_riskybiz",
  "inbound_krebs",
  "inbound_generic",
  "inbound_ato",
  "inbound_sans",
  "inbound_tldr_infosec",
  "inbound_thn",
  "inbound_securityweek",
] as const;

async function getSummary(svc: ReturnType<typeof createServiceClient>): Promise<Summary> {
  const costThresholdUsd = Number(process.env.DAILY_COST_THRESHOLD_USD ?? "2");
  const empty: Summary = {
    todayCostUsd: 0,
    todayCostEventCount: 0,
    feedbackOpen: 0,
    brakesPaused: 0,
    costThresholdUsd,
  };
  if (!svc) return empty;

  const [todayRes, feedbackRes, brakesRes] = await Promise.all([
    svc.from("today_cost_total").select("total_cost_usd, event_count").single(),
    svc.from("feedback_triage_queue").select("feedback_id", { count: "exact", head: true }),
    svc
      .from("feature_brakes")
      .select("feature", { count: "exact", head: true })
      .gt("paused_until", new Date().toISOString()),
  ]);

  return {
    todayCostUsd: Number(todayRes.data?.total_cost_usd ?? 0),
    todayCostEventCount: Number(todayRes.data?.event_count ?? 0),
    feedbackOpen: feedbackRes.count ?? 0,
    brakesPaused: brakesRes.count ?? 0,
    costThresholdUsd,
  };
}

async function getTiles(svc: ReturnType<typeof createServiceClient>): Promise<TileMetric[]> {
  if (!svc) return [];

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    quarantineRes,
    inboundActiveRes,
    brandAlertsRes,
    vulnsRes,
    phoneRes,
    onwardRes,
    blogDraftsRes,
    queuePendingRes,
    cloneWatchPendingRes,
    cloneWatchTpRes,
  ] = await Promise.all([
    svc
      .from("feed_items")
      .select("id", { count: "exact", head: true })
      .eq("published", false)
      .like("source", "inbound_%"),
    svc
      .from("feed_items")
      .select("source")
      .like("source", "inbound_%")
      .gte("created_at", since7d)
      .limit(2000),
    svc
      .from("brand_impersonation_alerts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    svc
      .from("vulnerabilities")
      .select("id", { count: "exact", head: true })
      .gte("cvss_score", 7)
      .gte("published_at", since7d),
    svc
      .from("phone_footprints")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7d),
    svc
      .from("onward_report_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7d),
    svc
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
    svc
      .from("bot_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    svc
      .from("shopfront_clone_alerts")
      .select("id", { count: "exact", head: true })
      .eq("source", "nrd")
      .eq("triage_status", "pending"),
    svc
      .from("shopfront_clone_alerts")
      .select("id", { count: "exact", head: true })
      .eq("source", "nrd")
      .in("triage_status", ["tp_confirmed", "tp_actioned"])
      .gte("first_seen_at", since7d),
  ]);

  const inboundActiveCount = new Set(
    (inboundActiveRes.data ?? []).map((r) => r.source as string),
  ).size;

  return [
    {
      href: "/admin/costs",
      title: "Costs",
      purpose: "AI + paid-API per-call spend",
      metric: "see banner",
      metricLabel: "Today's spend",
      secondary: "30d projection in dashboard",
    },
    {
      href: "/admin/costs/infra",
      title: "Infra cost rollup",
      purpose: "Daily per-provider billing (Vercel + Anthropic + Supabase)",
      metric: "30d total",
      metricLabel: "Cloud spend",
      secondary: "Rolled up by billing-ingest-nightly (02:00 UTC)",
    },
    {
      href: "/admin/feedback",
      title: "Feedback triage",
      purpose: "User disagreements ranked by uncertainty × harm",
      metric: "see banner",
      metricLabel: "Open queue",
    },
    {
      href: "/admin/health",
      title: "System health",
      purpose: "Bot queue, feed freshness, archive, Stripe",
      metric: String(queuePendingRes.count ?? 0),
      metricLabel: "Bot queue pending",
      warn: (queuePendingRes.count ?? 0) > 100,
    },
    {
      href: "/admin/inbound-quarantine",
      title: "Inbound queue",
      purpose: "Email-routed digests awaiting promote/delete",
      metric: String(quarantineRes.count ?? 0),
      metricLabel: "Rows in quarantine",
      warn: (quarantineRes.count ?? 0) > 50,
      secondary: `${inboundActiveCount} of ${ALL_INBOUND_SLUGS.length} sources active 7d`,
    },
    {
      href: "/admin/brand-alerts",
      title: "Brand alerts",
      purpose: "Brand impersonation hits surfaced for review",
      metric: String(brandAlertsRes.count ?? 0),
      metricLabel: "New 24h",
    },
    {
      href: "/admin/clone-watch",
      title: "Clone-watch triage",
      purpose: "Daily NRD candidates awaiting FP / TP / Investigate verdict",
      metric: String(cloneWatchPendingRes.count ?? 0),
      metricLabel: "Awaiting triage",
      warn: (cloneWatchPendingRes.count ?? 0) > 20,
      secondary: `${cloneWatchTpRes.count ?? 0} TP confirmed in last 7d`,
    },
    {
      href: "/admin/vulnerabilities",
      title: "Vulnerabilities",
      purpose: "CVE feed with AU-context enrichment",
      metric: String(vulnsRes.count ?? 0),
      metricLabel: "Critical CVSS≥7 in 7d",
    },
    {
      href: "/admin/phone-footprint",
      title: "Phone footprint",
      purpose: "Phone-intel lookups + telco-API cost telemetry",
      metric: String(phoneRes.count ?? 0),
      metricLabel: "Footprints 7d",
    },
    {
      href: "/admin/onward-reports",
      title: "Onward reports",
      purpose: "Forwarded scam reports to gov/brand recipients",
      metric: String(onwardRes.count ?? 0),
      metricLabel: "Sent 7d",
    },
    {
      href: "/admin/blog",
      title: "Blog",
      purpose: "Drafts, scheduled posts, generation pipeline",
      metric: String(blogDraftsRes.count ?? 0),
      metricLabel: "Drafts",
    },
    {
      href: "/admin/brand-outreach",
      title: "Brand reach-out",
      purpose: "One-off founder pilot email to a single brand contact",
      metric: "compose",
      metricLabel: "Four-eyes send",
      secondary: "Manual outreach — send yourself a test first",
    },
  ];
}

export default async function AdminIndexPage() {
  await requireAdmin();
  const svc = createServiceClient();

  const [summary, tiles] = await Promise.all([getSummary(svc), getTiles(svc)]);

  const todayOverBudget = summary.todayCostUsd >= summary.costThresholdUsd;
  const spendTone: StatTone = todayOverBudget ? "attention" : "neutral";
  const feedbackTone: StatTone =
    summary.feedbackOpen > 100 ? "attention" : summary.feedbackOpen > 0 ? "attention" : "neutral";
  const brakesTone: StatTone =
    summary.brakesPaused > 0 ? "danger" : "ok";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
      <header className="px-1 pb-4">
        <h1
          className="serif"
          style={{ fontSize: 26, color: "var(--color-ink)", letterSpacing: "-0.015em" }}
        >
          Overview
        </h1>
        <p
          className="mt-1"
          style={{
            fontSize: 13.5,
            color: "var(--color-muted)",
            lineHeight: 1.45,
          }}
        >
          Single starting point for operational work. Tap any tile for the full view.
        </p>
      </header>

      <section className="mb-3.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatTopCard
          label="Today's spend"
          value={`$${summary.todayCostUsd.toFixed(4)}`}
          sub={`${summary.todayCostEventCount} events · threshold $${summary.costThresholdUsd}`}
          tone={spendTone}
        />
        <StatTopCard
          label="Feedback queue"
          value={summary.feedbackOpen.toLocaleString()}
          sub={summary.feedbackOpen === 0 ? "no items awaiting triage" : "awaiting triage"}
          tone={feedbackTone}
        />
        <StatTopCard
          label="Paused brakes"
          value={summary.brakesPaused.toLocaleString()}
          sub={summary.brakesPaused === 0 ? "all features running" : "at least one feature paused"}
          tone={brakesTone}
        />
      </section>

      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <OverviewTile
            key={tile.href}
            href={tile.href}
            title={tile.title}
            sub={tile.purpose}
            primary={tile.metric}
            primaryLabel={tile.metricLabel}
            foot={tile.secondary}
            warn={tile.warn}
          />
        ))}
      </section>

      <div style={{ height: 32 }} />
    </div>
  );
}
