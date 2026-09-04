import { createServiceClient } from "@askarthur/supabase/server";
import { SUPPRESSION_LABELS } from "@askarthur/scam-engine/reddit-intel/take-validator";

import QueryErrorBand from "@/components/admin/QueryErrorBand";
import { requireAdmin } from "@/lib/adminAuth";
import { takeSlug } from "@/lib/arthurs-take/loader";

import TakeReviewActions from "./TakeReviewActions";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  feed_item_id: number;
  intent_label: string;
  confidence: number;
  take_status: string;
  take_suppressed_reason: string | null;
  take_tells: string[] | null;
  take_where: string | null;
  take_au_line: string | null;
  take_written_at: string | null;
  feed_items: { title: string | null; source_url: string | null } | null;
}

const CELL: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--color-line-soft)",
  verticalAlign: "top",
  fontSize: 13,
};

export default async function ArthursTakeReviewPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  const loadErrors: string[] = [];
  if (!supabase) loadErrors.push("service client unavailable");

  let rows: Row[] = [];
  let counts = { ready: 0, suppressed: 0, failed: 0, reviewed: 0, agree: 0 };

  if (supabase) {
    const { data, error } = await supabase
      .from("reddit_post_intel")
      .select(
        "id, feed_item_id, intent_label, confidence, take_status, take_suppressed_reason, take_tells, take_where, take_au_line, take_written_at, feed_items(title, source_url)",
      )
      .neq("take_status", "none")
      .order("take_written_at", { ascending: false, nullsFirst: false })
      .limit(100);
    // Without this a failed read renders "nothing to review", which an
    // operator reads as "all caught up" during an outage.
    if (error) loadErrors.push("take review queue");
    rows = (data ?? []) as unknown as Row[];

    const { data: statusRows, error: statusErr } = await supabase
      .from("reddit_post_intel")
      .select("take_status")
      .neq("take_status", "none");
    if (statusErr) loadErrors.push("take status counts");
    for (const r of statusRows ?? []) {
      const s = r.take_status as string;
      if (s === "ready") counts.ready += 1;
      else if (s === "suppressed") counts.suppressed += 1;
      else if (s === "failed") counts.failed += 1;
    }

    const { data: reviews, error: revErr } = await supabase
      .from("reddit_post_intel_reviews")
      .select("verdict");
    if (revErr) loadErrors.push("review verdicts");
    counts.reviewed = (reviews ?? []).length;
    counts.agree = (reviews ?? []).filter((r) => r.verdict === "agree").length;
  }

  const agreementPct =
    counts.reviewed > 0
      ? Math.round((counts.agree / counts.reviewed) * 100)
      : null;
  const suppressionPct =
    counts.ready + counts.suppressed > 0
      ? Math.round(
          (counts.suppressed / (counts.ready + counts.suppressed)) * 100,
        )
      : null;

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Arthur&rsquo;s Take — review</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, marginTop: 6 }}>
        The compensating control for what the write-time validator cannot see.
        It refuses amounts, emails, phone numbers and handles, but it cannot
        detect a personal name or a bare handle — those are indistinguishable
        from ordinary prose to a pattern match. <strong>pii</strong> and{" "}
        <strong>unsafe wording</strong> pull a live take down immediately.
      </p>

      <QueryErrorBand errors={loadErrors} />

      <div
        style={{
          display: "flex",
          gap: 20,
          margin: "18px 0",
          flexWrap: "wrap",
          fontSize: 13,
        }}
      >
        <span>
          ready <strong>{counts.ready}</strong>
        </span>
        <span>
          suppressed <strong>{counts.suppressed}</strong>
          {suppressionPct !== null ? ` (${suppressionPct}%)` : ""}
        </span>
        <span>
          failed <strong>{counts.failed}</strong>
        </span>
        <span>
          reviewed <strong>{counts.reviewed}</strong>
        </span>
        <span>
          agreement{" "}
          <strong>
            {agreementPct !== null ? `${agreementPct}%` : "—"}
          </strong>
        </span>
      </div>

      {rows.length === 0 && loadErrors.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
          No takes generated yet. Nothing to review.
        </p>
      ) : (
        <div
          style={{
            overflowX: "auto",
            border: "1px solid var(--color-line-soft)",
            borderRadius: 8,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--color-surface-2)" }}>
                <th style={{ ...CELL, textAlign: "left" }}>Post</th>
                <th style={{ ...CELL, textAlign: "left" }}>Take</th>
                <th style={{ ...CELL, textAlign: "left" }}>Status</th>
                <th style={{ ...CELL, textAlign: "left" }}>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...CELL, maxWidth: 240 }}>
                    <div style={{ fontWeight: 500 }}>
                      {r.feed_items?.title ?? `#${r.feed_item_id}`}
                    </div>
                    <div style={{ color: "var(--color-muted)", fontSize: 12 }}>
                      {r.intent_label} · conf {Number(r.confidence).toFixed(2)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      <a
                        href={`/scam-feed/${takeSlug(r.feed_item_id, r.feed_items?.title ?? "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        page ↗
                      </a>
                      {r.feed_items?.source_url ? (
                        <>
                          {" · "}
                          <a
                            href={r.feed_items.source_url}
                            target="_blank"
                            rel="noreferrer noopener nofollow"
                          >
                            reddit ↗
                          </a>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ ...CELL, maxWidth: 460 }}>
                    {(r.take_tells ?? []).map((t) => (
                      <div key={t}>• {t}</div>
                    ))}
                    {r.take_where ? (
                      <div style={{ marginTop: 6, color: "var(--color-ink-2)" }}>
                        {r.take_where}
                      </div>
                    ) : null}
                    {r.take_au_line ? (
                      <div style={{ marginTop: 4, color: "var(--color-ink-2)" }}>
                        AU: {r.take_au_line}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                    {r.take_status}
                    {r.take_suppressed_reason ? (
                      <div style={{ color: "var(--color-muted)", fontSize: 12 }}>
                        {SUPPRESSION_LABELS[
                          r.take_suppressed_reason as keyof typeof SUPPRESSION_LABELS
                        ] ?? r.take_suppressed_reason}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...CELL }}>
                    {/* Rendered for every status, not just `ready` — a
                        suppressed row still needs a restore path, and a
                        decision-only column would go dead on reload. */}
                    <TakeReviewActions
                      intelId={r.id}
                      status={r.take_status}
                      suppressedReason={r.take_suppressed_reason}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
