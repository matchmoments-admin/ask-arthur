import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { CandidateActions } from "./CandidateActions";

export const dynamic = "force-dynamic";

/**
 * Watchlist-candidate review queue.
 *
 * The weekly reddit-brands-discover digest proposes brands for the clone-watch
 * watchlist. Until now the only place a candidate appeared was
 * /admin/brand-register, which renders its status read-only — so in the month
 * from 2026-06-27 the queue reached 51 rows with zero ever actioned. This page
 * is the missing surface: it ranks candidates by Australian evidence and gives
 * each one a decision.
 *
 * Deliberately NOT feature-flagged. It is an admin-only read of a cold table
 * plus a status write; gating it behind a flag would reproduce the original
 * problem (a review queue nobody can reach) for no safety gain.
 */

interface CandidateRow {
  brand_normalized: string;
  raw_brand: string;
  mention_count: number;
  au_mention_count: number;
  source_counts: Record<string, number> | null;
  au_counts: Record<string, number> | null;
  resolved_canonical: string | null;
  status: string;
  status_note: string | null;
  status_changed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const CELL: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-line-soft)",
  fontSize: 13,
  verticalAlign: "top",
};
const NUM: React.CSSProperties = {
  ...CELL,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

function sourceSummary(counts: Record<string, number> | null): string {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return "—";
  return entries
    .map(([src, n]) => `${src === "scam_reports" ? "reported" : src} ×${n}`)
    .join(", ");
}

export default async function BrandCandidatesPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let rows: CandidateRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("reddit_watchlist_candidates")
      // AU evidence first — the whole reason the 2026-07-26 digest proposed
      // Xfinity and Chime for an Australian watchlist is that nothing ordered
      // on this. mention_count is the tie-break, not the primary key.
      .select("*")
      .order("au_mention_count", { ascending: false })
      .order("mention_count", { ascending: false })
      .limit(500);
    rows = (data ?? []) as CandidateRow[];
  }

  const pending = rows.filter((r) => r.status === "pending");
  const actioned = rows.filter((r) => r.status !== "pending");
  const auPending = pending.filter((r) => r.au_mention_count > 0);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Watchlist candidates — review queue
      </h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, marginBottom: 20 }}>
        {pending.length} pending ({auPending.length} with Australian evidence) ·{" "}
        {actioned.length} actioned. Brands seen impersonated in Reddit intel and
        in scams reported to Arthur, that are <b>not</b> yet on the clone-watch
        watchlist. Ranked by AU-attributable mentions — a large global count is
        a fact about r/Scams traffic, not about Australian exposure.
      </p>
      <p style={{ color: "var(--color-muted)", fontSize: 12, marginBottom: 20 }}>
        <b>Worth monitoring</b> records the decision; it does not yet add the
        brand to the live matcher. Promotion needs confirmed legitimate domains
        first — the matcher uses that list to exclude the brand&rsquo;s own site,
        so a brand promoted without it would be reported as a clone of itself.
      </p>

      {[
        { title: "Pending", data: pending },
        { title: "Actioned", data: actioned },
      ].map((section) => (
        <section key={section.title} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            {section.title} ({section.data.length})
          </h2>
          <div
            style={{
              overflowX: "auto",
              border: "1px solid var(--color-line-soft)",
              borderRadius: 8,
            }}
          >
            <table
              style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    background: "var(--color-surface-2)",
                  }}
                >
                  <th style={CELL}>Brand</th>
                  <th style={NUM}>AU</th>
                  <th style={NUM}>Total</th>
                  <th style={CELL}>Sources</th>
                  <th style={CELL}>Alias of</th>
                  <th style={CELL}>Last seen</th>
                  <th style={CELL}>
                    {section.title === "Pending" ? "Decision" : "Status"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.data.length === 0 ? (
                  <tr>
                    <td style={{ ...CELL, color: "var(--color-muted)" }} colSpan={7}>
                      {section.title === "Pending"
                        ? "Queue empty — nothing awaiting a decision."
                        : "Nothing actioned yet."}
                    </td>
                  </tr>
                ) : (
                  section.data.map((r) => (
                    <tr key={r.brand_normalized}>
                      <td style={{ ...CELL, fontWeight: 600 }}>{r.raw_brand}</td>
                      <td
                        style={{
                          ...NUM,
                          fontWeight: r.au_mention_count > 0 ? 700 : 400,
                          color:
                            r.au_mention_count > 0
                              ? "var(--color-ink-2)"
                              : "var(--color-muted)",
                        }}
                      >
                        {r.au_mention_count}
                      </td>
                      <td style={{ ...NUM, color: "var(--color-muted)" }}>
                        {r.mention_count}
                      </td>
                      <td style={{ ...CELL, color: "var(--color-muted)" }}>
                        {sourceSummary(r.source_counts)}
                      </td>
                      <td style={{ ...CELL, color: "var(--color-muted)" }}>
                        {r.resolved_canonical ?? "—"}
                      </td>
                      <td
                        style={{
                          ...CELL,
                          color: "var(--color-muted)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(r.last_seen_at).toLocaleDateString("en-AU")}
                      </td>
                      <td style={CELL}>
                        {r.status === "pending" ? (
                          <CandidateActions
                            brandNormalized={r.brand_normalized}
                            status={r.status}
                          />
                        ) : (
                          <span
                            style={{ fontSize: 12, color: "var(--color-muted)" }}
                            title={r.status_note ?? undefined}
                          >
                            {r.status}
                            {r.status_changed_at
                              ? ` · ${new Date(
                                  r.status_changed_at,
                                ).toLocaleDateString("en-AU")}`
                              : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
