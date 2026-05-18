import Link from "next/link";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

// Admin overview / landing page. Until this page existed, /admin produced a
// 404 and operators had to know the sub-page URLs (or sign-in always landed
// on /admin/blog). The dashboard surfaces today's cost spend, the open
// feedback queue, any paused cost brakes, and a tile per sub-page with one
// freshness metric — enough to decide where to drill down without burning a
// second click on a half-loaded data view.

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
  ] = await Promise.all([
    svc
      .from("feed_items")
      .select("id", { count: "exact", head: true })
      .eq("published", false)
      .like("source", "inbound_%"),
    // "Active" = produced ≥1 row in last 7d. Distinct source count via a
    // grouped select; pgrest doesn't expose distinct directly so we pull a
    // small set and count client-side.
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
  ];
}

export default async function AdminIndexPage() {
  await requireAdmin();
  const svc = createServiceClient();

  const [summary, tiles] = await Promise.all([getSummary(svc), getTiles(svc)]);

  const todayOverBudget = summary.todayCostUsd >= summary.costThresholdUsd;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-deep-navy text-2xl font-extrabold tracking-tight">Overview</h1>
        <p className="text-gov-slate mt-1 text-sm">
          Single starting point for operational work. Drill into any tile for the full view.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BannerCard
          label="Today's spend (USD)"
          value={`$${summary.todayCostUsd.toFixed(4)}`}
          warn={todayOverBudget}
          hint={`${summary.todayCostEventCount} events · threshold $${summary.costThresholdUsd}`}
        />
        <BannerCard
          label="Feedback queue"
          value={summary.feedbackOpen.toLocaleString()}
          warn={summary.feedbackOpen > 100}
          hint="user disagreements awaiting triage"
        />
        <BannerCard
          label="Paused cost brakes"
          value={summary.brakesPaused.toLocaleString()}
          warn={summary.brakesPaused > 0}
          danger={summary.brakesPaused > 0}
          hint={summary.brakesPaused === 0 ? "all features running" : "at least one feature paused"}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Tile key={tile.href} {...tile} />
        ))}
      </section>
    </main>
  );
}

function BannerCard({
  label,
  value,
  warn,
  danger,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  const border = danger
    ? "border-red-300 bg-red-50"
    : warn
      ? "border-amber-300 bg-amber-50"
      : "border-slate-200 bg-white";
  const valueColor = danger ? "text-red-700" : warn ? "text-amber-700" : "text-slate-900";
  return (
    <div className={`rounded-md border px-4 py-3 ${border}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function Tile({ href, title, purpose, metric, metricLabel, warn, secondary }: TileMetric) {
  const border = warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white";
  const metricColor = warn ? "text-amber-700" : "text-slate-900";
  return (
    <Link
      href={href}
      className={`group block rounded-md border px-4 py-4 transition-shadow hover:shadow-sm ${border}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-deep-navy text-base font-semibold group-hover:underline">{title}</h2>
        <span className="text-action-teal text-xs">→</span>
      </div>
      <p className="text-gov-slate mt-1 text-xs leading-snug">{purpose}</p>
      <div className="mt-3">
        <div className={`text-xl font-semibold ${metricColor}`}>{metric}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{metricLabel}</div>
        {secondary ? <div className="mt-1 text-xs text-slate-500">{secondary}</div> : null}
      </div>
    </Link>
  );
}
