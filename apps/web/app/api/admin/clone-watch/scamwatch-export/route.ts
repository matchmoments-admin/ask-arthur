import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

// Scamwatch report-a-scam form is consumer-facing and rate-limited; it
// has no public API. The pragmatic path: admin downloads a CSV of the
// last N days of TP-confirmed clone-watch alerts shaped for paste-in
// upload to scamwatch.gov.au, ACCC's InfoCentre, or any other public
// AU scam intel channel. The Playwright automation is parked as a
// follow-up.
//
// GET /api/admin/clone-watch/scamwatch-export?days=7
//   -> text/csv attachment with one row per TP-confirmed alert
//
// Default range is 7 days (matches the weekly digest cadence) so an
// operator can run this each Sunday after seeing the digest Telegram.
// Capped at 90 days so the file stays small enough for a manual upload.

export const dynamic = "force-dynamic";

interface AlertRow {
  id: number;
  inferred_target_domain: string;
  candidate_domain: string;
  candidate_url: string;
  first_seen_at: string;
  triage_at: string | null;
  severity_tier: string | null;
  signals: unknown;
}

export async function GET(req: NextRequest) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneOutreach) {
    return NextResponse.json(
      { error: "clone_outreach_disabled" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const rawDays = url.searchParams.get("days") ?? "7";
  const days = clampDays(Number.parseInt(rawDays, 10));

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select(
      "id, inferred_target_domain, candidate_domain, candidate_url, first_seen_at, triage_at, severity_tier, signals",
    )
    .eq("source", "nrd")
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: true });

  if (error) {
    logger.error("scamwatch-export: query failed", { error: error.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data as AlertRow[] | null) ?? [];
  const csv = buildScamwatchCsv(rows);

  logCost({
    feature: "shopfront_clone_scamwatch_export",
    provider: "internal",
    operation: "csv_export",
    units: 1,
    unitCostUsd: 0,
    metadata: {
      days,
      rows_exported: rows.length,
    },
  });

  logger.info("scamwatch-export: generated", {
    days,
    rows: rows.length,
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `askarthur-clone-watch-scamwatch-${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── Pure helpers (exported for unit testing) ─────────────────────────────

/** Clamp the ?days param to a sensible range. Defaults to 7 on garbage. */
export function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 7;
  if (n > 90) return 90;
  return Math.floor(n);
}

interface SignalShape {
  signal_type?: unknown;
  score?: unknown;
}

/** Extract a (signal_type, score) tuple from the first signal in the
 *  jsonb array. Returns ('', NaN) when the shape is unexpected. */
export function firstSignal(
  signals: unknown,
): { signal_type: string; score: number } {
  if (!Array.isArray(signals) || signals.length === 0) {
    return { signal_type: "", score: NaN };
  }
  const s = signals[0] as SignalShape;
  return {
    signal_type:
      typeof s?.signal_type === "string" ? s.signal_type : "",
    score: typeof s?.score === "number" ? s.score : NaN,
  };
}

/** RFC 4180 CSV field escaping. Wraps in quotes if the value contains
 *  a comma, quote, or newline; doubles embedded quotes. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build the Scamwatch CSV. Columns are chosen to match the most common
 * fields on the scamwatch.gov.au report form + ACCC InfoCentre intake:
 *
 *   first_seen_iso       — first time the clone-watch matcher saw the
 *                          candidate domain (ISO 8601)
 *   confirmed_at_iso     — when an Ask Arthur admin TP-confirmed it
 *   scam_url             — the candidate URL (the actual scam)
 *   scam_domain          — the candidate domain (URL host)
 *   impersonated_brand   — legitimate target domain (the brand being
 *                          impersonated)
 *   scam_type            — fixed: "Phishing - brand impersonation"
 *   evidence_signal      — matcher signal type (e.g. levenshtein,
 *                          au_token, brand_substring)
 *   evidence_score       — matcher score (0-1, 2 decimals)
 *   severity             — low / medium / high / critical
 *   source               — fixed: "Ask Arthur clone-watch"
 *   reporter_email       — fixed: "brendan@askarthur.au" (us)
 *
 * One row per TP-confirmed alert. Returns just the header when input
 * is empty.
 */
export function buildScamwatchCsv(rows: AlertRow[]): string {
  const header = [
    "first_seen_iso",
    "confirmed_at_iso",
    "scam_url",
    "scam_domain",
    "impersonated_brand",
    "scam_type",
    "evidence_signal",
    "evidence_score",
    "severity",
    "source",
    "reporter_email",
  ].join(",");

  const lines = rows.map((row) => {
    const { signal_type, score } = firstSignal(row.signals);
    const scoreText = Number.isFinite(score) ? score.toFixed(2) : "";
    return [
      csvField(row.first_seen_at),
      csvField(row.triage_at),
      csvField(row.candidate_url),
      csvField(row.candidate_domain),
      csvField(row.inferred_target_domain),
      csvField("Phishing - brand impersonation"),
      csvField(signal_type),
      csvField(scoreText),
      csvField(row.severity_tier),
      csvField("Ask Arthur clone-watch"),
      csvField("brendan@askarthur.au"),
    ].join(",");
  });

  // RFC 4180 — CRLF line endings.
  return [header, ...lines].join("\r\n") + "\r\n";
}
