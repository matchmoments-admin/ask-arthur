import { requireAdmin } from "@/lib/adminAuth";
import type { Tables } from "@askarthur/types";
import { createServiceClient } from "@askarthur/supabase/server";
import TriageTable from "./TriageTable";

export const dynamic = "force-dynamic";

type TriageRowRaw = Tables<"feedback_triage_queue">;

const VERDICT_VALUES = ["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"] as const;
const USER_SAYS_VALUES = ["false_positive", "false_negative", "user_reported"] as const;

export type TriageRow = TriageRowRaw & {
  feedback_id: number;
  feedback_created_at: string;
  verdict_given: (typeof VERDICT_VALUES)[number];
  user_says: (typeof USER_SAYS_VALUES)[number];
  uncertainty: number;
  impact_weight: number;
  triage_score: number;
};

function isTriageRow(r: TriageRowRaw): r is TriageRow {
  return (
    r.feedback_id != null &&
    r.feedback_created_at != null &&
    r.uncertainty != null &&
    r.impact_weight != null &&
    r.triage_score != null &&
    r.verdict_given != null &&
    (VERDICT_VALUES as readonly string[]).includes(r.verdict_given) &&
    r.user_says != null &&
    (USER_SAYS_VALUES as readonly string[]).includes(r.user_says)
  );
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
    // Single round-trip via v133 RPC (replaces 3 sequential queries).
    // Server-side aggregation against the v94 MV; ~2.5 ms on prod.
    const { data: summary } = await supabase.rpc(
      "get_feedback_triage_summary",
      { p_filter: filter, p_limit: 100 },
    );

    if (summary && typeof summary === "object") {
      const s = summary as {
        rows?: TriageRowRaw[];
        total?: number;
        counts?: Partial<typeof counts>;
      };
      rows = (s.rows ?? []).filter(isTriageRow);
      totalCount = s.total ?? 0;
      if (s.counts) {
        for (const k of ["false_positive", "false_negative", "user_reported"] as const) {
          counts[k] = s.counts[k] ?? 0;
        }
      }
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
