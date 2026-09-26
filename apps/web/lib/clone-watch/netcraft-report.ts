/**
 * Netcraft report — the ONE Module that talks to Netcraft's report intake.
 *
 * Before 2026-09-23 the POST existed twice (the per-candidate manual lane with
 * a 20 s timeout, the bulk lanes with 30 s), the reporter-email fallback three
 * times, and the report reason in three places; only the manual path advanced
 * the Clone Lifecycle to `reported`. This Module owns: the endpoint (live vs
 * validation-only test), the reporter identity (Netcraft credits reports to
 * this email — no account needed; leaderboard handle br_4918435), the body
 * builders, the POST (one timeout, never throws), and recording the result on
 * the alerts. Lanes decide WHAT to report and WHEN; this decides HOW.
 *
 * Per-URL verdicts are read back by netcraft-urls.ts (the reconciler's reader).
 */
import type { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

const NETCRAFT_POST_TIMEOUT_MS = 30_000;

export const NETCRAFT_REPORT_ENDPOINT =
  "https://report.netcraft.com/api/v3/report/urls";
// Validation-only endpoint: checks the payload, creates no report, sends no
// email. Used by test mode so we never abuse the live intake while validating.
export const NETCRAFT_TEST_ENDPOINT =
  "https://report.netcraft.com/api/v3/test/report/urls";

/** Netcraft credits a report to the submitting email (no account or key
 *  needed). One source for it — was `?? "brendan@askarthur.au"` in three
 *  places. */
export const DEFAULT_NETCRAFT_REPORTER = "brendan@askarthur.au";
export function netcraftReporterEmail(): string {
  return (
    process.env.NETCRAFT_REPORTER_EMAIL?.trim() || DEFAULT_NETCRAFT_REPORTER
  );
}
export interface NetcraftBulkBody {
  email: string;
  reason: string;
  urls: Array<{ url: string; country: string }>;
}

export interface NetcraftBulkResult {
  ok: boolean;
  status: number;
  uuid: string | null;
  state: string | null;
  errText: string | null;
  raw: Record<string, unknown>;
  urlCount: number;
}

/** Row shape returned by list_clone_alerts_pending_netcraft_auto. */
export interface NetcraftAutoCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string;
  severity_tier: string | null;
  signals: unknown;
}

/** Row shape returned by list_clone_alerts_pending_netcraft_resubmit. */
export interface NetcraftResubmitCandidate {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  urlscan_uuid: string | null;
  weaponised_at: string | null;
  /** 24h submission allowance left, identical on every row (v252). */
  budget_remaining?: number | null;
}

/**
 * Pure builder for the bulk Netcraft report body. One batch-level reason (the
 * bulk endpoint takes a single reason for all urls); each url is AU. Dedupes
 * urls so the same candidate_url isn't sent twice in one batch.
 */
export function buildNetcraftBulkBody(
  candidates: NetcraftAutoCandidate[],
  reporterEmail: string,
): NetcraftBulkBody {
  const seen = new Set<string>();
  const urls: Array<{ url: string; country: string }> = [];
  for (const c of candidates) {
    if (!c.candidate_url || seen.has(c.candidate_url)) continue;
    seen.add(c.candidate_url);
    urls.push({ url: c.candidate_url, country: "AU" });
  }
  return {
    email: reporterEmail,
    reason:
      "Possible clones / lookalike-typosquat domains of Australian brands, " +
      "detected via Ask Arthur clone-watch's daily NRD lexical sweep " +
      "(askarthur.au brand watchlist; high-confidence preclassifier matches). " +
      "Submitted in good faith for Netcraft classification.",
    urls,
  };
}

/**
 * Pure builder for the RE-submission body. Distinct reason text from the
 * auto-report lane: this batch is not "please classify these lookalikes", it is
 * "we watched these turn into live phishing and you have no open record of
 * them" — which is the whole justification for re-approaching Netcraft on a URL
 * they may have seen before. Cites the urlscan evidence so a human reviewer can
 * verify rather than take our word.
 */
export function buildNetcraftResubmitBody(
  candidates: NetcraftResubmitCandidate[],
  reporterEmail: string,
): NetcraftBulkBody {
  const seen = new Set<string>();
  const urls: Array<{ url: string; country: string }> = [];
  for (const c of candidates) {
    if (!c.candidate_url || seen.has(c.candidate_url)) continue;
    seen.add(c.candidate_url);
    urls.push({ url: c.candidate_url, country: "AU" });
  }
  const evidence = candidates
    .filter((c) => c.urlscan_uuid)
    .slice(0, 10)
    .map(
      (c) =>
        `${c.candidate_domain} (impersonating ${c.inferred_target_domain ?? "an Australian brand"}): https://urlscan.io/result/${c.urlscan_uuid}/`,
    );
  return {
    email: reporterEmail,
    reason:
      "Confirmed phishing on Australian-brand lookalike domains, detected by " +
      "Ask Arthur clone-watch (askarthur.au). Each of these was monitored from " +
      "registration and has since been observed serving suspected " +
      "credential-harvest or payment-fraud content by our own urlscan.io scan. " +
      "They are being reported fresh because no current Netcraft submission " +
      "covers them. Scan evidence:\n" +
      (evidence.length ? evidence.join("\n") : "(scan references unavailable)"),
    urls,
  };
}

/**
 * The one place either lane talks to Netcraft's bulk intake.
 *
 * `test: true` targets the validation-only endpoint — it checks the payload,
 * creates NO report and sends NO confirmation email. Both lanes route through
 * here so "which endpoint does test mode hit" is a single decision with a
 * single test, rather than a duplicated ternary per lane. Never throws: the
 * callers soft-fail a non-2xx into a $0 diagnostic, because an Inngest fn error
 * pages the Axiom fleet watch. "Never throws" now includes the transport: a
 * network error or the timeout used to escape as a thrown AbortError (the
 * header promised otherwise) and failed the whole step; it now returns
 * `{ ok:false, status:0 }` like any other soft failure.
 */
export async function postNetcraftBulk(
  body: NetcraftBulkBody,
  opts: { test: boolean },
): Promise<NetcraftBulkResult> {
  const apiKey = process.env.NETCRAFT_REPORT_API_KEY;
  let res: Response;
  try {
    res = await fetch(
      opts.test ? NETCRAFT_TEST_ENDPOINT : NETCRAFT_REPORT_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NETCRAFT_POST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    return {
      ok: false,
      status: 0,
      uuid: null,
      state: null,
      errText: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      raw: {},
      urlCount: body.urls.length,
    };
  }
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return {
    ok: res.ok,
    status: res.status,
    uuid: typeof parsed.uuid === "string" ? parsed.uuid : null,
    state: typeof parsed.state === "string" ? parsed.state : null,
    errText: res.ok ? null : text.slice(0, 200),
    raw: parsed,
    urlCount: body.urls.length,
  };
}

/**
 * Record an ACCEPTED auto-lane bulk submission on each alert: the submission
 * ledger (`submitted_to.netcraft`, triage `tp_actioned` — the RPC stamps
 * `triage_source = 'machine'` unless the alert was a human `tp_confirmed`, so a
 * lane-actioned deferral never reads as a human true positive; v338, #1263)
 * and — where the SQL
 * lifecycle guard allows it — `detected|monitoring → reported`. The advance is
 * best-effort: most auto submissions are already `weaponised` (v284 evidence
 * gate), and `weaponised → reported` is not an edge, so a refusal is expected
 * and logged (sampled info), never thrown. Returns how many ledger writes landed.
 */
export async function recordAutoSubmission(
  sb: Sb,
  alertIds: number[],
  result: Pick<NetcraftBulkResult, "uuid" | "state">,
): Promise<number> {
  const submittedAt = new Date().toISOString();
  let marked = 0;
  for (const id of alertIds) {
    const { error } = await sb.rpc("merge_clone_alert_submission", {
      p_alert_id: id,
      p_key: "netcraft",
      p_value: {
        uuid: result.uuid,
        state: result.state,
        submitted_at: submittedAt,
        via: "auto_bulk",
      },
      p_set_triage_status: "tp_actioned",
    });
    if (error) {
      logger.error("netcraft-report: mark-submitted failed", {
        alertId: id,
        error: error.message,
      });
      continue;
    }
    marked++;
    const { error: advanceErr } = await sb.rpc("advance_clone_lifecycle", {
      p_alert_id: id,
      p_to_state: "reported",
    });
    if (advanceErr) {
      logger.info(
        "netcraft-report: lifecycle stays (guard refused reported)",
        {
          alertId: id,
          error: advanceErr.message,
        },
      );
    }
  }
  return marked;
}
