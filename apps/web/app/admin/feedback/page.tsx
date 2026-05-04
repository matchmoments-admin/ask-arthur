import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import TriageTable from "./TriageTable";

export const dynamic = "force-dynamic";

export interface TriageRow {
  feedback_id: number;
  feedback_created_at: string;
  verdict_given: "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK";
  user_says: "false_positive" | "false_negative" | "user_reported";
  reason_codes: string[] | null;
  training_consent: boolean | null;
  comment: string | null;
  locale: string | null;
  user_agent_family: string | null;
  submitted_content_hash: string | null;
  report_id: number | null;
  analysis_id: string | null;
  scrubbed_content: string | null;
  verdict_confidence: number | null;
  scam_type: string | null;
  impersonated_brand: string | null;
  report_source: string | null;
  report_created_at: string | null;
  uncertainty: number;
  impact_weight: number;
  triage_score: number;
}

type FilterMode = "top" | "false_positive" | "false_negative" | "user_reported";

export default async function FeedbackTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = (sp.filter ?? "top") as FilterMode;

  const supabase = createServiceClient();
  let rows: TriageRow[] = [];
  let totalCount = 0;
  const counts = { false_positive: 0, false_negative: 0, user_reported: 0 };

  if (supabase) {
    let query = supabase
      .from("feedback_triage_queue")
      .select("*")
      .order("triage_score", { ascending: false })
      .order("feedback_created_at", { ascending: false })
      .limit(100);

    if (filter !== "top") {
      query = query.eq("user_says", filter);
    }

    const { data } = await query;
    rows = (data ?? []) as TriageRow[];

    const { count } = await supabase
      .from("feedback_triage_queue")
      .select("*", { count: "exact", head: true });
    totalCount = count ?? 0;

    // Per-class counts (cheap — MV is at most a few thousand rows).
    const { data: classRows } = await supabase
      .from("feedback_triage_queue")
      .select("user_says");
    for (const r of classRows ?? []) {
      const k = r.user_says as keyof typeof counts;
      if (k in counts) counts[k] += 1;
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Feedback triage</h1>
      <p className="text-gov-slate text-sm mb-6">
        User disagreements with verdicts, ranked by uncertainty × harm. Scored as
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
          (1 - |confidence - 0.5| · 2) × impact_weight
        </code>
        — peaks where the model was 50/50 AND the user disagreed. Refreshed every 5 min by the{" "}
        <code className="font-mono text-xs">feedback-triage-refresh</code> Inngest cron.
      </p>

      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <FilterPill href="/admin/feedback?filter=top" active={filter === "top"} label={`Top ${totalCount}`} />
        <FilterPill
          href="/admin/feedback?filter=false_negative"
          active={filter === "false_negative"}
          label={`False-negatives (${counts.false_negative})`}
          tone="danger"
        />
        <FilterPill
          href="/admin/feedback?filter=user_reported"
          active={filter === "user_reported"}
          label={`User-reported (${counts.user_reported})`}
          tone="warn"
        />
        <FilterPill
          href="/admin/feedback?filter=false_positive"
          active={filter === "false_positive"}
          label={`False-positives (${counts.false_positive})`}
        />
      </div>

      <TriageTable rows={rows} />
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
