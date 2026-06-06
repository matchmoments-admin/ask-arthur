import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { render } from "@react-email/components";
import { Resend } from "resend";
import CloneWatchRunSummary, {
  type CloneWatchRunSummaryItem,
} from "@/emails/CloneWatchRunSummary";
import { logCost, PRICING } from "@/lib/cost-telemetry";

/**
 * Clone-watch auto-triage — auto-confirm the high-confidence, still-live tail
 * so an operator no longer has to click "clone / not" on the obvious cases.
 *
 * The deferred PR-5 from the partner-data plan, scoped to the SAFE envelope the
 * review demanded:
 *
 *   ELIGIBILITY (the "strict" bar — all must hold):
 *     • Haiku preclassify is_clone = true AND confidence ≥ 0.9
 *     • primary signal_type ∈ {confusable, levenshtein}  (excludes the
 *       ~70%-raw-FP 'substring' class)
 *     • urlscan_classification = 'likely_phishing'  (independent signal)
 *     • triage_status IS NULL (not already actioned)
 *
 *   LIVENESS GATE (operator's ask — "auto scan the page is actually still up
 *   then brand email"): re-fetch candidate_url; only proceed if it still
 *   responds. A clone that's already dead/taken-down isn't worth a notification.
 *
 *   ON PASS: set triage_status='tp_confirmed' (clears the manual queue + feeds
 *   the public /clone-watch page).
 *
 * NOTIFICATION: ONE run-summary email per run (not one per clone), listing each
 * auto-confirmed clone + the hosting IP/country/ASN urlscan already captured.
 *
 * SEND ROUTING (shadow-first, mirroring the brand-stewardship design):
 *   • CLONE_WATCH_SHADOW_RECIPIENT (falls back to BRAND_STEWARDSHIP_SHADOW_RECIPIENT)
 *     set → the summary goes THERE (validation; sending to ourselves carries no
 *     defamation/legal risk, so it does NOT need the #371 sign-off).
 *   • unset → auto-confirm only, NO email. Real-brand auto-send is intentionally
 *     out of scope here (it stays the #371-gated manual/batch path).
 *
 * This function deliberately does NOT emit CLONE_WATCH_TRIAGED_EVENT, so it
 * never triggers the real-brand notify-brand fan-out or Netcraft submission
 * (we have no Netcraft key anyway). It is fully inert until
 * FF_CLONE_WATCH_AUTO_TRIAGE is ON.
 *
 * Expected runtime « 5 min: capped at AUTO_TRIAGE_RUN_CAP alerts/run.
 */

const STRICT_CONFIDENCE = 0.9;
const ELIGIBLE_SIGNALS = new Set(["confusable", "levenshtein"]);
const FETCH_CANDIDATE_LIMIT = 50; // pre-filter pool
const AUTO_TRIAGE_RUN_CAP = 15; // hard cap on auto-confirm+send per run
const LIVENESS_TIMEOUT_MS = 8000;
const RECENT_WINDOW_DAYS = 14;

export interface AlertRow {
  id: number;
  inferred_target_domain: string | null;
  candidate_domain: string;
  candidate_url: string;
  signals: unknown;
  urlscan_evidence: {
    screenshot_url?: string;
    result_url?: string;
    // Hosting attribution urlscan already captures (clone-watch-urlscan.ts
    // serialiseEvidence → server: result.serverInfo).
    server?: { ip?: string | null; country?: string | null; asn?: string | null };
  } | null;
  first_seen_at: string;
}

/** Primary signal_type of an alert's signals[] (the strongest/first signal). */
export function primarySignalType(signals: unknown): string | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const s = signals[0];
  if (s && typeof s === "object" && "signal_type" in s) {
    const t = (s as { signal_type?: unknown }).signal_type;
    return typeof t === "string" ? t : null;
  }
  return null;
}

/** True when the alert clears the deterministic part of the strict bar. */
export function passesStrictSignal(signals: unknown): boolean {
  const t = primarySignalType(signals);
  return t !== null && ELIGIBLE_SIGNALS.has(t);
}

/**
 * Project an alert into a run-summary item, lifting the hosting attribution
 * (IP / country / ASN) urlscan already stored in urlscan_evidence.server.
 * Pure — unit-tested.
 */
export function toSummaryItem(alert: AlertRow): CloneWatchRunSummaryItem {
  const server = alert.urlscan_evidence?.server ?? null;
  return {
    brand: alert.inferred_target_domain ?? alert.candidate_domain,
    candidateDomain: alert.candidate_domain,
    candidateUrl: alert.candidate_url,
    hostingIp: server?.ip ?? null,
    hostingCountry: server?.country ?? null,
    asn: server?.asn ?? null,
    screenshotUrl: alert.urlscan_evidence?.screenshot_url ?? null,
  };
}

/**
 * Liveness probe: is the candidate URL still serving? "Live" = any HTTP
 * response < 500 within the timeout (a 401/403/404 still means the host is up;
 * a taken-down clone usually fails DNS/connection or 5xxs). Never throws.
 */
export async function isCandidateLive(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVENESS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "AskArthur-CloneWatch/1.0 (+https://askarthur.au)" },
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const cloneWatchAutoTriage = inngest.createFunction(
  {
    id: "clone-watch-auto-triage",
    name: "Clone-watch: auto-triage the confident, live tail",
    timeouts: { finish: "5m" },
    retries: 2,
  },
  { cron: "0 13 * * *" }, // daily, after the 08:30 NRD ingest + urlscan/preclassify
  withAxiomLogging({ fnId: "clone-watch-auto-triage" }, async ({ step }) => {
    if (!featureFlags.cloneWatchAutoTriage) {
      return { skipped: true, reason: "FF_CLONE_WATCH_AUTO_TRIAGE disabled" };
    }

    const shadowRecipient =
      readStringEnv("CLONE_WATCH_SHADOW_RECIPIENT") ||
      readStringEnv("BRAND_STEWARDSHIP_SHADOW_RECIPIENT") ||
      null;

    // 1. Pre-filter pool: pending, urlscan-flagged, recent NRD alerts.
    const eligible = await step.run("select-eligible", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as AlertRow[];
      const since = new Date(
        Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: alerts, error } = await sb
        .from("shopfront_clone_alerts")
        .select(
          "id, inferred_target_domain, candidate_domain, candidate_url, signals, urlscan_evidence, first_seen_at",
        )
        .is("triage_status", null)
        .eq("source", "nrd")
        .eq("urlscan_classification", "likely_phishing")
        .gte("first_seen_at", since)
        .order("first_seen_at", { ascending: false })
        .limit(FETCH_CANDIDATE_LIMIT);
      if (error) {
        logger.error("clone-watch auto-triage: alert select failed", {
          error: error.message,
        });
        return [] as AlertRow[];
      }
      const pool = (alerts ?? []) as AlertRow[];
      if (pool.length === 0) return pool;

      // Strict Haiku gate: is_clone AND confidence ≥ 0.9.
      const { data: cls } = await sb
        .from("clone_watch_classifications")
        .select("alert_id, is_clone, confidence")
        .in(
          "alert_id",
          pool.map((a) => a.id),
        )
        .eq("is_clone", true)
        .gte("confidence", STRICT_CONFIDENCE);
      const confident = new Set((cls ?? []).map((c) => c.alert_id as number));

      // Deterministic signal gate + cap. inferred_target_domain required for
      // the brand-facing email.
      return pool
        .filter(
          (a) =>
            confident.has(a.id) &&
            passesStrictSignal(a.signals) &&
            a.inferred_target_domain,
        )
        .slice(0, AUTO_TRIAGE_RUN_CAP);
    });

    if (eligible.length === 0) {
      return { ok: true, eligible: 0, confirmed: 0, emailed: 0 };
    }

    // Stable run date (YYYY-MM-DD) — computed in a step so it's memoised across
    // Inngest replays and is safe to key the email idempotency on.
    const runDate = await step.run("run-date", () =>
      new Date().toISOString().slice(0, 10),
    );

    let confirmed = 0;
    let offline = 0;
    const items: CloneWatchRunSummaryItem[] = [];

    for (const alert of eligible) {
      // Liveness gate — own step so a slow fetch doesn't re-run the rest.
      const live = await step.run(`liveness-${alert.id}`, () =>
        isCandidateLive(alert.candidate_url),
      );
      if (!live) {
        offline += 1;
        logger.info("clone-watch auto-triage: candidate offline, skipping", {
          alertId: alert.id,
          candidate: alert.candidate_domain,
        });
        continue;
      }

      // Auto-confirm (tp_confirmed) + stamp submitted_to in one step. Marks the
      // alert confirmed (clears the manual queue + surfaces on /clone-watch)
      // and records the shadow-summary handling. Does NOT emit the triaged
      // event, so no real-brand fan-out / Netcraft.
      const confirmedOk = await step.run(`confirm-${alert.id}`, async () => {
        const sb = createServiceClient();
        if (!sb) return false;
        const { error } = await sb.rpc("set_clone_alert_triage", {
          p_alert_id: alert.id,
          p_status: "tp_confirmed",
          p_admin_id: null,
          p_notes:
            "auto-triage: strict bar (Haiku≥0.9 + confusable/levenshtein + urlscan likely_phishing) + liveness pass",
        });
        if (error) {
          logger.error("clone-watch auto-triage: confirm rpc failed", {
            alertId: alert.id,
            error: error.message,
          });
          return false;
        }
        // Mark handled (shadow summary) so the notify-brand consumer + dashboard
        // treat it as already-notified. Non-fatal.
        const { error: stampErr } = await sb.rpc("merge_clone_alert_submission", {
          p_alert_id: alert.id,
          p_key: "brand_notification",
          p_value: {
            channel_type: "shadow_summary",
            recipient: shadowRecipient,
            status: "sent",
            sent_at: new Date().toISOString(),
            ts: new Date().toISOString(),
          },
          p_set_triage_status: null,
        });
        if (stampErr) {
          logger.warn("clone-watch auto-triage: submitted_to stamp failed", {
            alertId: alert.id,
            error: stampErr.message,
          });
        }
        return true;
      });
      if (!confirmedOk) continue;
      confirmed += 1;

      // Collect the hosting attribution urlscan already captured for the digest.
      items.push(toSummaryItem(alert));
    }

    // ONE run-summary email to the shadow recipient (validation). No shadow
    // recipient → auto-confirm only, no email.
    let emailed = false;
    if (shadowRecipient && items.length > 0) {
      emailed = await step.run("send-run-summary", async () => {
        const apiKey = process.env.RESEND_API_KEY;
        const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
        if (!apiKey || !fromEmail) {
          logger.error("clone-watch auto-triage: RESEND env unset", {
            hasKey: Boolean(apiKey),
            hasFrom: Boolean(fromEmail),
          });
          return false;
        }
        const html = await render(
          CloneWatchRunSummary({
            runDate,
            eligible: eligible.length,
            confirmed,
            offline,
            items,
          }),
        );
        const resend = new Resend(apiKey);
        const result = await resend.emails.send(
          {
            from: fromEmail,
            to: [shadowRecipient],
            subject: `[SHADOW] Clone-watch auto-triage — ${confirmed} confirmed (${runDate})`,
            html,
          },
          { idempotencyKey: `clone-auto-summary:${runDate}` },
        );
        if (result.error) {
          logger.error("clone-watch auto-triage: Resend rejected", {
            error: result.error.message ?? String(result.error),
          });
          return false;
        }
        logCost({
          feature: "shopfront_clone_auto_triage",
          provider: "resend",
          operation: "run_summary",
          units: 1,
          unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
          metadata: { run_date: runDate, confirmed, recipient: "shadow" },
        });
        return true;
      });
    }

    logger.info("clone-watch auto-triage: complete", {
      eligible: eligible.length,
      confirmed,
      offline,
      emailed,
      shadow: Boolean(shadowRecipient),
    });
    return {
      ok: true,
      eligible: eligible.length,
      confirmed,
      offline,
      emailed,
      mode: shadowRecipient ? "shadow" : "confirm_only",
    };
  }),
);
