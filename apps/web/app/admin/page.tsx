import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import StatTopCard, { type StatTone } from "@/components/admin/overview/StatTopCard";
import OverviewTile from "@/components/admin/overview/OverviewTile";
import QueryErrorBand from "@/components/admin/QueryErrorBand";
import { readCount, fmtCount, over } from "@/lib/dashboard/read-count";

export const dynamic = "force-dynamic";

// Admin overview / landing page. Surfaces today's cost spend, the open
// feedback queue, any paused cost brakes, and a tile per sub-page with
// one freshness metric — enough to decide where to drill down without
// burning a second click on a half-loaded data view.

interface Summary {
  todayCostUsd: number;
  todayCostEventCount: number;
  feedbackOpen: number | null;
  brakesPaused: number | null;
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

async function getSummary(
  svc: ReturnType<typeof createServiceClient>,
  loadErrors: string[],
): Promise<Summary> {
  const costThresholdUsd = Number(process.env.DAILY_COST_THRESHOLD_USD ?? "2");
  const empty: Summary = {
    todayCostUsd: 0,
    todayCostEventCount: 0,
    feedbackOpen: 0,
    brakesPaused: 0,
    costThresholdUsd,
  };
  if (!svc) {
    loadErrors.push("service client unavailable");
    return empty;
  }

  const [todayRes, feedbackRes, brakesRes] = await Promise.all([
    svc.from("today_cost_total").select("total_cost_usd, event_count").single(),
    svc.from("feedback_triage_queue").select("feedback_id", { count: "exact", head: true }),
    svc
      .from("feature_brakes")
      .select("feature", { count: "exact", head: true })
      .gt("paused_until", new Date().toISOString()),
  ]);

  // PGRST116 = "no rows" from .single(); on a day with no spend yet that is the
  // correct answer, not a failure.
  if (todayRes.error && todayRes.error.code !== "PGRST116") {
    loadErrors.push("today's spend");
  }

  return {
    todayCostUsd: Number(todayRes.data?.total_cost_usd ?? 0),
    todayCostEventCount: Number(todayRes.data?.event_count ?? 0),
    feedbackOpen: readCount(feedbackRes, "feedback queue", loadErrors),
    brakesPaused: readCount(brakesRes, "paused brakes", loadErrors),
    costThresholdUsd,
  };
}

async function getTiles(
  svc: ReturnType<typeof createServiceClient>,
  loadErrors: string[],
): Promise<TileMetric[]> {
  if (!svc) return [];

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    quarantineRes,
    inboundActiveRes,
    brandAlertsRes,
    vulnsRes,
    onwardRes,
    blogDraftsRes,
    queuePendingRes,
    cloneWatchPendingRes,
    cloneWatchTpRes,
    brandCandidatesPendingRes,
    brandCandidatesAuRes,
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
      // 1000 is PostgREST's hard ceiling; asking for more silently got 1000.
      // This one only feeds a distinct-source Set of ~17 possible values, so
      // one page is ample — but the number must not claim otherwise.
      .limit(1000),
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
    svc
      .from("reddit_watchlist_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    // AU-evidenced is the number that decides whether the queue is worth
    // opening. A large raw pending count is a fact about r/Scams traffic, not
    // about Australian exposure — ranking on it is exactly how the queue
    // reached 51 rows with zero ever actioned.
    svc
      .from("reddit_watchlist_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gt("au_mention_count", 0),
  ]);

  if (inboundActiveRes.error) loadErrors.push("inbound source activity");
  const inboundActiveCount = inboundActiveRes.error
    ? null
    : new Set((inboundActiveRes.data ?? []).map((r) => r.source as string)).size;

  const quarantine = readCount(quarantineRes, "inbound quarantine", loadErrors);
  const brandAlerts = readCount(brandAlertsRes, "brand alerts", loadErrors);
  const vulns = readCount(vulnsRes, "vulnerabilities", loadErrors);
  const onward = readCount(onwardRes, "onward reports", loadErrors);
  const blogDrafts = readCount(blogDraftsRes, "blog drafts", loadErrors);
  const queuePending = readCount(queuePendingRes, "bot queue", loadErrors);
  const clonePending = readCount(cloneWatchPendingRes, "clone-watch triage backlog", loadErrors);
  const cloneTp = readCount(cloneWatchTpRes, "clone-watch TP count", loadErrors);
  const candidatesPending = readCount(brandCandidatesPendingRes, "watchlist candidates", loadErrors);
  const candidatesAu = readCount(brandCandidatesAuRes, "AU-evidenced candidates", loadErrors);

  return [
    {
      href: "/admin/weekly-review",
      title: "Weekly review",
      purpose: "The Monday signal rhythm — live numbers + the recorded log",
      metric: "Mon",
      metricLabel: "Run weekly",
    },
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
      metric: fmtCount(queuePending),
      metricLabel: "Bot queue pending",
      warn: over(queuePending, 100),
    },
    {
      href: "/admin/inbound-quarantine",
      title: "Inbound queue",
      purpose: "Email-routed digests awaiting promote/delete",
      metric: fmtCount(quarantine),
      metricLabel: "Rows in quarantine",
      warn: over(quarantine, 50),
      secondary: `${fmtCount(inboundActiveCount)} of ${ALL_INBOUND_SLUGS.length} sources active 7d`,
    },
    {
      href: "/admin/brand-alerts",
      title: "Brand alerts",
      purpose: "Brand impersonation hits surfaced for review",
      metric: fmtCount(brandAlerts),
      metricLabel: "New 24h",
    },
    {
      href: "/admin/clone-watch",
      title: "Clone-watch triage",
      purpose: "Daily NRD candidates awaiting FP / TP / Investigate verdict",
      metric: fmtCount(clonePending),
      metricLabel: "Awaiting triage",
      warn: over(clonePending, 20),
      secondary: `${fmtCount(cloneTp)} TP confirmed in last 7d`,
    },
    {
      // Was reachable ONLY via a text link at the bottom of /admin/brand-register,
      // so the operator surface for the whole discovery loop was effectively
      // undiscoverable — the founder could not find it to action a digest that
      // links straight to it.
      href: "/admin/brand-candidates",
      title: "Watchlist candidates",
      purpose: "Impersonated brands not yet on the clone-watch watchlist",
      // The AU-evidenced count leads because it is the actionable one; the raw
      // pending total sits underneath as context.
      metric: fmtCount(candidatesAu),
      metricLabel: "AU-evidenced pending",
      secondary: `${fmtCount(candidatesPending)} pending in total`,
    },
    {
      href: "/admin/vulnerabilities",
      title: "Vulnerabilities",
      purpose: "CVE feed with AU-context enrichment",
      metric: fmtCount(vulns),
      metricLabel: "Critical CVSS≥7 in 7d",
    },
    // Phone-footprint tile removed (map #939, verdict #944): the feature is
    // mothballed — the read-only panel stays at /admin/phone-footprint for
    // the revive condition, but the overview no longer advertises it.
    {
      href: "/admin/onward-reports",
      title: "Onward reports",
      purpose: "Forwarded scam reports to gov/brand recipients",
      metric: fmtCount(onward),
      metricLabel: "Sent 7d",
    },
    {
      href: "/admin/blog",
      title: "Blog",
      purpose: "Drafts, scheduled posts, generation pipeline",
      metric: fmtCount(blogDrafts),
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

  const loadErrors: string[] = [];
  const [summary, tiles] = await Promise.all([
    getSummary(svc, loadErrors),
    getTiles(svc, loadErrors),
  ]);

  const todayOverBudget = summary.todayCostUsd >= summary.costThresholdUsd;
  const spendTone: StatTone = todayOverBudget ? "attention" : "neutral";
  const feedbackTone: StatTone =
    summary.feedbackOpen !== null && summary.feedbackOpen > 0 ? "attention" : "neutral";
  // An unknown brake count must NOT read "ok" — "all features running" is the
  // single most consequential green on this page, and a failed read is exactly
  // when it would be a lie.
  const brakesTone: StatTone =
    summary.brakesPaused === null
      ? "attention"
      : summary.brakesPaused > 0
        ? "danger"
        : "ok";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
      <QueryErrorBand errors={loadErrors} />
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
          value={summary.feedbackOpen?.toLocaleString() ?? "—"}
          sub={
            summary.feedbackOpen === null
              ? "could not be read"
              : summary.feedbackOpen === 0
                ? "no items awaiting triage"
                : "awaiting triage"
          }
          tone={feedbackTone}
        />
        <StatTopCard
          label="Paused brakes"
          value={summary.brakesPaused?.toLocaleString() ?? "—"}
          sub={
            summary.brakesPaused === null
              ? "could not be read — do NOT read this as all-clear"
              : summary.brakesPaused === 0
                ? "all features running"
                : "at least one feature paused"
          }
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
