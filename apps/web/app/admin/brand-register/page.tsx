import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const dynamic = "force-dynamic";

interface BrandRegisterRow {
  canonical_brand: string;
  display_name: string;
  on_au_watchlist: boolean;
  scam_30d: number;
  reddit_30d: number;
  clone_open_alerts: number;
  curation_status: string | null;
  cross_stream_priority: number;
  updated_at: string;
}

const CELL: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-line-soft)",
  fontSize: 13,
  whiteSpace: "nowrap",
};
const NUM: React.CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function num(n: number, tone?: "scam" | "clone" | "reddit") {
  if (!n) return <span style={{ color: "var(--color-muted)" }}>0</span>;
  const color =
    tone === "scam"
      ? "var(--color-hr-fg, #b91c1c)"
      : tone === "clone"
        ? "#b45309"
        : "var(--color-ink-2)";
  return <span style={{ color, fontWeight: 600 }}>{n}</span>;
}

export default async function BrandRegisterPage() {
  await requireAdmin();

  if (!featureFlags.brandRegister) {
    notFound();
  }

  const supabase = createServiceClient();
  let rows: BrandRegisterRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("brand_register")
      .select("*")
      .order("cross_stream_priority", { ascending: false })
      .order("display_name", { ascending: true })
      .limit(500);
    rows = (data ?? []) as BrandRegisterRow[];
  }

  const lastRefresh = rows.reduce<string | null>(
    (acc, r) => (acc && acc > r.updated_at ? acc : r.updated_at),
    null,
  );
  const active = rows.filter(
    (r) => r.scam_30d || r.reddit_30d || r.clone_open_alerts,
  ).length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Brand Register — brand 360
      </h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, marginBottom: 20 }}>
        {rows.length} brands · {active} active in the last 30 days ·{" "}
        {lastRefresh
          ? `refreshed ${new Date(lastRefresh).toLocaleString("en-AU")}`
          : "not yet refreshed"}
        . One row per canonical brand across reported-scams, Reddit-intel and
        clone-watch. Priority = scam×3 + clone×2 + reddit×1 (an ordering hint,
        not a clone severity).
      </p>

      <div style={{ overflowX: "auto", border: "1px solid var(--color-line-soft)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
          <thead>
            <tr style={{ textAlign: "left", background: "var(--color-surface-2)" }}>
              <th style={CELL}>Brand</th>
              <th style={CELL}>Watchlist</th>
              <th style={NUM}>Scams 30d</th>
              <th style={NUM}>Reddit 30d</th>
              <th style={NUM}>Open clones</th>
              <th style={CELL}>Curation</th>
              <th style={NUM}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={{ ...CELL, color: "var(--color-muted)" }} colSpan={7}>
                  No rows yet — the nightly brand-register-refresh cron populates
                  this once FF_BRAND_REGISTER is on. Fire it now with the
                  brand-register/refresh.manual-trigger.v1 Inngest event.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.canonical_brand}>
                  <td style={{ ...CELL, fontWeight: 600 }}>{r.display_name}</td>
                  <td style={CELL}>
                    {r.on_au_watchlist ? (
                      <span style={{ color: "var(--color-ink-2)" }}>watched</span>
                    ) : (
                      <span style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={NUM}>{num(r.scam_30d, "scam")}</td>
                  <td style={NUM}>{num(r.reddit_30d, "reddit")}</td>
                  <td style={NUM}>{num(r.clone_open_alerts, "clone")}</td>
                  <td style={CELL}>
                    {r.curation_status ? (
                      <span style={{ color: "var(--color-muted)" }}>
                        {r.curation_status}
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...NUM, fontWeight: 700 }}>
                    {r.cross_stream_priority}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
