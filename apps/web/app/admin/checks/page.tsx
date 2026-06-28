import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import ChecksDashboard from "./ChecksDashboard";

export const dynamic = "force-dynamic";

// Recent-checks admin viewer. Read-only.
//
// Why this exists: the homepage "VERIFIED CHECKS" counter is
// SUM(check_stats.total_checks) — bumped by increment_check_stats() on every
// analyze call — and is NOT 1:1 with stored scam_reports rows (separate write
// path; create_scam_report is ON CONFLICT(idempotency_key) idempotent and can
// early-return). This page lists recent scam_reports AND reconciles the counter
// against stored rows so an operator can explain the divergence.
//
// Timezone note: increment_check_stats writes CURRENT_DATE and the prod session
// runs UTC, so check_stats.date is a UTC date. The per-day reconciliation below
// buckets scam_reports.created_at in UTC (toISOString slice) to match — do NOT
// bucket in Australia/Sydney or edge-of-midnight rows will mis-align.

const VERDICT_VALUES = ["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"] as const;
const DAY_WINDOWS = [1, 7, 30, 90] as const;

export type ChecksRow = {
  id: number;
  created_at: string;
  source: string | null;
  channel: string | null;
  input_mode: string | null;
  verdict: string;
  confidence_score: number | null;
  scam_type: string | null;
  impersonated_brand: string | null;
  region: string | null;
  country_code: string | null;
  scrubbed_content: string | null;
};

export type ReconRow = {
  date: string;
  counterTotal: number;
  storedRows: number;
  delta: number;
};

export type Rollups = {
  bySource: Record<string, number>;
  byVerdict: Record<string, number>;
};

export type ChecksTotals = {
  counterAllTime: number; // SUM(check_stats.total_checks) — the homepage number
  storedHot: number; // scam_reports row count
  storedArchive: number; // scam_reports_archive row count
  residual: number; // counterAllTime - storedHot - storedArchive
};

/** Clamp the ?days= param to an allowed window; default 7. */
function parseDays(raw: string | undefined): number {
  const n = Number(raw);
  return (DAY_WINDOWS as readonly number[]).includes(n) ? n : 7;
}

// Wrapped so the impure Date.now() call isn't made directly in the component
// render body (matches the helper pattern in app/admin/costs/page.tsx).
function windowStart(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export default async function ChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; verdict?: string; days?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const days = parseDays(sp.days);
  const source = sp.source?.trim() || undefined;
  const verdict =
    sp.verdict && (VERDICT_VALUES as readonly string[]).includes(sp.verdict)
      ? sp.verdict
      : undefined;

  const since = windowStart(days);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const supabase = createServiceClient();
  if (!supabase) {
    return (
      <div className="p-8 text-sm text-gov-slate">Service client unavailable.</div>
    );
  }

  // --- Recent reports (filtered, capped). scam_reports is RLS deny-all → service role. ---
  let query = supabase
    .from("scam_reports")
    .select(
      "id, created_at, source, channel, input_mode, verdict, confidence_score, scam_type, impersonated_brand, region, country_code, scrubbed_content",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(100);
  if (source) query = query.eq("source", source);
  if (verdict) query = query.eq("verdict", verdict);
  const { data: reportData } = await query;
  const rows = (reportData ?? []) as ChecksRow[];

  // --- Rollups: reduce the fetched rows in JS (no extra round-trip). ---
  const rollups: Rollups = { bySource: {}, byVerdict: {} };
  for (const r of rows) {
    const s = r.source ?? "(none)";
    rollups.bySource[s] = (rollups.bySource[s] ?? 0) + 1;
    rollups.byVerdict[r.verdict] = (rollups.byVerdict[r.verdict] ?? 0) + 1;
  }

  // --- Reconciliation (per-day, within window). ---
  const [{ data: statsRows }, { data: reconReports }] = await Promise.all([
    supabase
      .from("check_stats")
      .select("date, total_checks")
      .gte("date", sinceDate),
    supabase
      .from("scam_reports")
      .select("id, created_at")
      .gte("created_at", sinceIso),
  ]);

  const counterByDate = new Map<string, number>();
  for (const s of statsRows ?? []) {
    const d = s.date as string;
    counterByDate.set(d, (counterByDate.get(d) ?? 0) + (s.total_checks ?? 0));
  }
  const storedByDate = new Map<string, number>();
  for (const r of reconReports ?? []) {
    const d = new Date(r.created_at as string).toISOString().slice(0, 10); // UTC bucket
    storedByDate.set(d, (storedByDate.get(d) ?? 0) + 1);
  }
  const reconDates = new Set<string>([
    ...counterByDate.keys(),
    ...storedByDate.keys(),
  ]);
  const recon: ReconRow[] = [...reconDates]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const counterTotal = counterByDate.get(date) ?? 0;
      const storedRows = storedByDate.get(date) ?? 0;
      return { date, counterTotal, storedRows, delta: counterTotal - storedRows };
    });

  // --- All-time headline totals (the canonical 104 / 68 / 5). ---
  const [{ data: allStats }, { count: hotCount }, { count: archiveCount }] =
    await Promise.all([
      supabase.from("check_stats").select("total_checks"),
      supabase
        .from("scam_reports")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("scam_reports_archive")
        .select("id", { count: "exact", head: true }),
    ]);
  const counterAllTime = (allStats ?? []).reduce(
    (acc, r) => acc + (r.total_checks ?? 0),
    0,
  );
  const storedHot = hotCount ?? 0;
  const storedArchive = archiveCount ?? 0;
  const totals: ChecksTotals = {
    counterAllTime,
    storedHot,
    storedArchive,
    residual: counterAllTime - storedHot - storedArchive,
  };

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Recent checks</h1>
      <p className="text-gov-slate text-sm mb-6">
        Per-analysis records from{" "}
        <code className="font-mono text-xs">scam_reports</code> with source,
        channel, verdict and region. The homepage counter is a separate{" "}
        <code className="font-mono text-xs">check_stats</code> tally — see the
        reconciliation panel for why the two numbers differ.
      </p>

      <FilterBar
        days={days}
        source={source}
        verdict={verdict}
        bySource={rollups.bySource}
      />

      <ChecksDashboard
        rows={rows}
        rollups={rollups}
        recon={recon}
        totals={totals}
        days={days}
      />
    </div>
  );
}

function FilterBar({
  days,
  source,
  verdict,
  bySource,
}: {
  days: number;
  source: string | undefined;
  verdict: string | undefined;
  bySource: Record<string, number>;
}) {
  const build = (next: Partial<{ days: number; source?: string; verdict?: string }>) => {
    const params = new URLSearchParams();
    const d = next.days ?? days;
    if (d !== 7) params.set("days", String(d));
    const s = "source" in next ? next.source : source;
    if (s) params.set("source", s);
    const v = "verdict" in next ? next.verdict : verdict;
    if (v) params.set("verdict", v);
    const qs = params.toString();
    return qs ? `/admin/checks?${qs}` : "/admin/checks";
  };

  const sourceKeys = Object.keys(bySource).sort();

  return (
    <div className="mb-6 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gov-slate mr-1">Window</span>
        {DAY_WINDOWS.map((d) => (
          <FilterPill key={d} href={build({ days: d })} active={days === d} label={`${d}d`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gov-slate mr-1">Verdict</span>
        <FilterPill href={build({ verdict: undefined })} active={!verdict} label="All" />
        {VERDICT_VALUES.map((v) => (
          <FilterPill
            key={v}
            href={build({ verdict: v })}
            active={verdict === v}
            label={v}
            tone={v === "HIGH_RISK" ? "danger" : v === "SUSPICIOUS" ? "warn" : undefined}
          />
        ))}
      </div>
      {sourceKeys.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gov-slate mr-1">Source</span>
          <FilterPill href={build({ source: undefined })} active={!source} label="All" />
          {sourceKeys.map((s) => (
            <FilterPill key={s} href={build({ source: s })} active={source === s} label={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  label,
  tone,
}: {
  href: string;
  active: boolean;
  label: string;
  tone?: "danger" | "warn";
}) {
  const base = "rounded-full border px-3 py-1 transition-colors";
  const inactive = "border-slate-200 bg-white text-gov-slate hover:bg-slate-50";
  const activeStyle =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-900"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-deep-navy bg-deep-navy text-white";
  return (
    <a href={href} className={`${base} ${active ? activeStyle : inactive}`}>
      {label}
    </a>
  );
}
