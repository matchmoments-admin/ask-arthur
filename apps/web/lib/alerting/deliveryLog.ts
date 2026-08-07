import { createHash } from "node:crypto";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  sendAdminTelegramMessage,
  type AdminMessageResult,
} from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Alerter delivery accounting — see migration-v263 for the full why.
 *
 * THE RULE every alerter must follow: write exactly ONE row per firing,
 * including the firing where nothing was wrong. That is what makes a MISSING
 * row mean "the alerter did not run" instead of "nothing was wrong". Skip the
 * healthy-case row and silence becomes indistinguishable from death again,
 * which is how a feed reached 89 days at zero successes unnoticed.
 *
 * Use `alertAndRecord()` for the "something is wrong, tell the operator" path
 * and `recordNoAlertNeeded()` for the quiet path. Both are best-effort: a
 * failure to RECORD must never break the cron that was trying to warn you, so
 * neither throws.
 */

/** Keep in sync with the CHECK constraint in migration-v263. */
export type AlertOutcome =
  | "sent"
  | "no_alert_needed"
  | "skipped_no_config"
  | "muted"
  | "failed";

/**
 * Canonical alerter ids. These match the cron route directory names, and the
 * acceptance-test liveness query expects a row for every one of them.
 *
 * Expected firings per 7 days, for the liveness check:
 *   pg-stuck-query-watchdog 2016 | axiom-fleet-watch 672 | scraper-brake-alert 672
 *   cost-daily-check 28 | health-digest 7 | feedback-digest 7
 *   clone-lead-digest 1 | cost-weekly-digest 1
 */
export const ALERTERS = [
  "cost-daily-check",
  "cost-weekly-digest",
  "health-digest",
  "feedback-digest",
  "scraper-brake-alert",
  "pg-stuck-query-watchdog",
  "clone-lead-digest",
  "axiom-fleet-watch",
  // The weekly synthetic canary (Tier 2 item 5): sends unconditionally every
  // Monday and liveness-sweeps the other alerters' row counts. Its own
  // liveness is proven by the message arriving, so it exempts itself from
  // the sweep floors.
  "alerting-canary",
] as const;

export type Alerter = (typeof ALERTERS)[number];

type RecordArgs = {
  alerter: Alerter;
  conditionMet: boolean;
  outcome: AlertOutcome;
  channel?: string;
  error?: string;
  latencyMs?: number;
  /** Message body — hashed, never stored. */
  payload?: string;
  metadata?: Record<string, unknown>;
};

/** Short digest of the message body. Never store the body: it can carry scam
 * text and user-adjacent detail, and this table is an operational log. */
function digest(payload: string | undefined): string | null {
  if (!payload) return null;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Write one delivery row. Best-effort: logs and returns on failure rather than
 * throwing, because breaking an alerter to record an alert would be perverse.
 */
export async function recordAlertDelivery(args: RecordArgs): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      logger.warn("recordAlertDelivery: no service client", { alerter: args.alerter });
      return;
    }

    const { error } = await supabase.from("alert_delivery_log").insert({
      alerter: args.alerter,
      condition_met: args.conditionMet,
      channel: args.channel ?? "telegram",
      outcome: args.outcome,
      error: args.error ?? null,
      latency_ms: args.latencyMs ?? null,
      payload_digest: digest(args.payload),
      metadata: args.metadata ?? {},
    });

    if (error) {
      logger.warn("recordAlertDelivery: insert failed", {
        alerter: args.alerter,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn("recordAlertDelivery threw", {
      alerter: args.alerter,
      error: String(err),
    });
  }
}

/**
 * The quiet path: the alerter ran and found nothing worth reporting.
 *
 * Call this on EVERY early return. It is the row whose absence means the cron
 * did not execute. `metadata` is a good place for the numbers that justified
 * the quiet verdict (rows scanned, feeds checked) so a wrong "all clear" is
 * diagnosable after the fact.
 */
export async function recordNoAlertNeeded(
  alerter: Alerter,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await recordAlertDelivery({
    alerter,
    conditionMet: false,
    outcome: "no_alert_needed",
    channel: "none",
    metadata,
  });
}

/**
 * Send an admin Telegram alert AND record the outcome.
 *
 * Prefer this over calling sendAdminTelegramMessage directly from an alerter —
 * it makes it impossible to send without recording, which is the mistake that
 * produced the current blind spot.
 *
 * `muted` covers the case where a feature flag deliberately suppressed a send
 * that was otherwise warranted; it is recorded distinctly from
 * 'no_alert_needed' so a flag silently disabling an alerter is visible in the
 * same query that checks liveness.
 */
export async function alertAndRecord(opts: {
  alerter: Alerter;
  text: string;
  /** When false, the send is skipped and recorded as 'muted'. */
  enabled?: boolean;
  parseMode?: "HTML" | "MarkdownV2";
  metadata?: Record<string, unknown>;
}): Promise<AdminMessageResult> {
  const { alerter, text, enabled = true, parseMode, metadata } = opts;

  if (!enabled) {
    await recordAlertDelivery({
      alerter,
      conditionMet: true,
      outcome: "muted",
      channel: "none",
      payload: text,
      metadata,
    });
    return { ok: false, reason: "no_config", latencyMs: 0 };
  }

  const result = await sendAdminTelegramMessage(text, { parseMode });

  await recordAlertDelivery({
    alerter,
    conditionMet: true,
    outcome: result.ok
      ? "sent"
      : result.reason === "no_config"
        ? "skipped_no_config"
        : "failed",
    error: result.error,
    latencyMs: result.latencyMs,
    payload: text,
    metadata,
  });

  return result;
}
