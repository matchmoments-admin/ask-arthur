import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_TRIAGED_EVENT,
  parseCloneWatchTriagedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { Resend } from "resend";
import { render } from "@react-email/components";
import CloneWatchBrandAlert from "@/emails/CloneWatchBrandAlert";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Layer 3+4 — brand notification consumer.
 *
 * Routes the triaged event to one of:
 *   Layer 3 (formal channels):
 *     - security_txt   → email send to RFC 9116 Contact: address (AusPost, CBA)
 *   Layer 3 (manual queue):
 *     - bugcrowd_vdp   → Telegram-page admin to open the VDP page (Kmart/Target)
 *   Layer 4 (courtesy email):
 *     - fraud_inbox    → email send to curated fraud/abuse address
 *     - contact_form   → Telegram-page admin to fill the web form
 *   Skip:
 *     - manual_review  → Telegram-page admin to look up + add to directory
 *     - none           → silently log; no recipient known
 *
 * Idempotency via Inngest's `idempotency: "event.data.alertId"` + a
 * read-then-write check on shopfront_clone_alerts.submitted_to.brand_notification.
 *
 * See docs/plans/clone-watch-outreach.md §7-§8 Phases 3 + 4.
 */

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <brendan@askarthur.au>";
const REPLY_TO_EMAIL = "brendan@askarthur.au";

export type DirectoryChannel =
  | "bugcrowd_vdp"
  | "security_txt"
  | "fraud_inbox"
  | "contact_form"
  | "manual_review"
  | "none";

interface DirectoryRow {
  brand: string;
  legitimate_domain: string;
  channel_type: DirectoryChannel;
  recipient: string | null;
  evidence_format: string;
  notes: string | null;
}

export type SeverityTier = "low" | "medium" | "high" | "critical";

export type NotificationAction =
  | { kind: "skip"; reason: string }
  | { kind: "manual_action"; channel: DirectoryChannel }
  | { kind: "email"; channel: "security_txt" | "fraud_inbox" }
  | {
      kind: "enqueue_digest";
      channel: "security_txt" | "fraud_inbox";
      severity: "low";
    };

/**
 * Pure routing function — given a directory row + severity tier, return
 * the action to take. Extracted from the Inngest handler so we can
 * unit-test channel + severity branching without mocking Supabase /
 * Resend / Inngest step machinery.
 *
 * Severity gate (PR-B Phase 1 calibration):
 *   - critical / high → email immediately (existing behaviour)
 *   - medium          → email immediately (preserves no-regression default
 *                       while the daily-batch consumer is unbuilt; future
 *                       follow-up flips this to enqueue + daily cron)
 *   - low             → enqueue into clone_alert_notification_queue;
 *                       surfaces in the weekly digest only. Stops the
 *                       low-severity noise floor from spamming brand
 *                       security inboxes.
 *
 * `severity` is optional so callers that haven't been updated still get
 * the legacy behaviour (treated as 'medium' = send immediately).
 */
export function decideNotificationAction(
  row: DirectoryRow | null,
  severity: SeverityTier = "medium",
): NotificationAction {
  if (!row) return { kind: "skip", reason: "no_directory_row" };
  if (row.channel_type === "none") return { kind: "skip", reason: "channel_none" };
  if (
    row.channel_type === "bugcrowd_vdp" ||
    row.channel_type === "contact_form" ||
    row.channel_type === "manual_review"
  ) {
    return { kind: "manual_action", channel: row.channel_type };
  }
  if (row.channel_type === "security_txt" || row.channel_type === "fraud_inbox") {
    if (!row.recipient) {
      return { kind: "skip", reason: "directory_recipient_null" };
    }
    if (severity === "low") {
      return { kind: "enqueue_digest", channel: row.channel_type, severity };
    }
    return { kind: "email", channel: row.channel_type };
  }
  return { kind: "skip", reason: "unknown_channel_type" };
}

/**
 * Compute the next Sunday 09:00 UTC for the weekly-digest queue. Pure so
 * we can unit-test it with a fixed `now`.
 */
export function nextWeeklyDigestSchedule(now: Date = new Date()): Date {
  const d = new Date(now);
  // 0 = Sunday in JS getUTCDay()
  const dow = d.getUTCDay();
  const daysUntilSunday = dow === 0 ? 7 : 7 - dow;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

export const cloneWatchNotifyBrand = inngest.createFunction(
  {
    id: "shopfront-clone-notify-brand",
    name: "Clone-Watch: Notify brand",
    retries: 3,
    concurrency: { limit: 4 },
    idempotency: "event.data.alertId",
    rateLimit: {
      // Don't spam any one brand. 5 sends per brand per 24h is plenty
      // headroom for the current ~7 hits/day across 5 brands rate.
      limit: 5,
      period: "24h",
      key: "event.data.brand",
    },
  },
  { event: CLONE_WATCH_TRIAGED_EVENT },
  async ({ event, step }) => {
    const data = parseCloneWatchTriagedData(event.data);

    if (!featureFlags.shopfrontCloneOutreach) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
    }
    if (!featureFlags.shopfrontCloneNotifyBrand) {
      return {
        skipped: true,
        reason: "FF_SHOPFRONT_CLONE_NOTIFY_BRAND disabled",
      };
    }

    const sb = createServiceClient();
    if (!sb) {
      return { skipped: true, reason: "supabase_unavailable" };
    }

    // Look up brand contact directory by legitimate_domain (which is what
    // shopfront_clone_alerts.inferred_target_domain stores).
    const directoryRow = await step.run("load-brand-contact", async () => {
      const { data: rows } = await sb
        .from("brand_contact_directory")
        .select(
          "brand, legitimate_domain, channel_type, recipient, evidence_format, notes",
        )
        .eq("legitimate_domain", data.brand)
        .maybeSingle();
      return rows as DirectoryRow | null;
    });

    if (!directoryRow) {
      logger.info("clone-watch notify: no directory row", {
        brand: data.brand,
      });
      await step.run("telegram-no-directory-row", async () => {
        await sendAdminTelegramMessage(
          [
            `<b>Clone-watch — brand_contact_directory missing</b>`,
            `Brand: <code>${escapeHtml(data.brand)}</code>`,
            `Candidate: <code>${escapeHtml(data.candidateDomain)}</code>`,
            `Add a row via SQL or skip this brand for outreach.`,
          ].join("\n"),
        );
      });
      return { skipped: true, reason: "no_directory_row" };
    }

    if (directoryRow.channel_type === "none") {
      return { skipped: true, reason: "channel_none" };
    }

    // Dedup — never re-notify the same alert if we've already SENT (or
    // a STOP-suppressed) email. Manual-action rows live under a separate
    // key (`brand_notification_queued`) so re-triaging them DOES re-page
    // the admin instead of silently no-op'ing — fixes ultrareview H3.
    const alreadyNotified = await step.run("check-dedup", async () => {
      const { data: row } = await sb
        .from("shopfront_clone_alerts")
        .select("submitted_to")
        .eq("id", data.alertId)
        .maybeSingle();
      const submitted_to =
        (row?.submitted_to as Record<string, unknown> | null) ?? {};
      return Boolean(submitted_to.brand_notification);
    });
    if (alreadyNotified) {
      return { skipped: true, reason: "already_notified" };
    }

    // Manual-action channels — Telegram-page the admin instead of auto-sending
    if (
      directoryRow.channel_type === "bugcrowd_vdp" ||
      directoryRow.channel_type === "contact_form" ||
      directoryRow.channel_type === "manual_review"
    ) {
      await step.run("telegram-admin-manual", async () => {
        const lines = [
          `<b>Clone-watch — manual brand outreach needed</b>`,
          `Brand: <b>${escapeHtml(directoryRow.brand)}</b> (${escapeHtml(data.brand)})`,
          `Candidate: <code>${escapeHtml(data.candidateDomain)}</code>`,
          `Channel: <i>${directoryRow.channel_type}</i>`,
        ];
        if (directoryRow.recipient) {
          lines.push(`Open: ${directoryRow.recipient}`);
        }
        lines.push(`Triage queue: askarthur.au/admin/clone-watch`);
        await sendAdminTelegramMessage(lines.join("\n"));
      });

      // Manual-action rows go under a DIFFERENT key
      // (brand_notification_queued) so the dedup check above doesn't
      // short-circuit on re-triage. The admin acting via Telegram is the
      // real send completion; until then, the row remains re-triageable.
      await persistManualQueue(sb, data.alertId, {
        channel_type: directoryRow.channel_type,
        recipient: directoryRow.recipient,
        queued_at: new Date().toISOString(),
      });
      return {
        ok: true,
        channel: directoryRow.channel_type,
        manual: true,
      };
    }

    // Email channels: security_txt + fraud_inbox
    if (
      directoryRow.channel_type === "security_txt" ||
      directoryRow.channel_type === "fraud_inbox"
    ) {
      if (!directoryRow.recipient) {
        return { skipped: true, reason: "directory_recipient_null" };
      }

      // Severity gate (PR-B Phase 1 calibration): low-severity alerts
      // enqueue into clone_alert_notification_queue + surface in the
      // weekly digest only, instead of emailing the brand security inbox
      // each time. Stops the noise floor from training brand teams to
      // treat AskArthur mail as low-signal. high/critical/medium still
      // send immediately.
      const severity = (data.severityTier as SeverityTier) ?? "medium";
      if (severity === "low") {
        await step.run("enqueue-low-severity-digest", async () => {
          await sb.rpc("enqueue_clone_alert_notification", {
            p_alert_id: data.alertId,
            p_brand: directoryRow.brand,
            p_candidate_domain: data.candidateDomain,
            p_candidate_url: data.candidateUrl,
            p_recipient: directoryRow.recipient!,
            p_channel_type: directoryRow.channel_type,
            p_severity_tier: "low",
            p_scheduled_for: nextWeeklyDigestSchedule().toISOString(),
          });
        });
        await persistNotification(sb, data.alertId, {
          channel_type: directoryRow.channel_type,
          recipient: directoryRow.recipient,
          status: "skipped",
          sent_at: null,
        });
        logger.info("clone-watch notify: low-severity enqueued for digest", {
          alertId: data.alertId,
          brand: directoryRow.brand,
        });
        return {
          ok: true,
          channel: directoryRow.channel_type,
          enqueued: true,
          severity,
        };
      }

      // Suppression check (Phase C) — if the recipient has previously
      // replied STOP, never send again. The check is cheap (indexed
      // partial WHERE classified_as='stop') and runs before Resend so
      // we never bill an email that'd hit a suppressed inbox.
      const suppressed = await step.run("check-suppression", async () => {
        const { data } = await sb.rpc(
          "clone_alert_recipient_is_suppressed",
          { p_email: directoryRow.recipient },
        );
        return Boolean(data);
      });
      if (suppressed) {
        logger.info("clone-watch notify: suppressed recipient", {
          alertId: data.alertId,
          recipient: directoryRow.recipient,
        });
        await persistNotification(sb, data.alertId, {
          channel_type: directoryRow.channel_type,
          recipient: directoryRow.recipient,
          status: "skipped",
          sent_at: null,
        });
        return { skipped: true, reason: "recipient_stop_suppressed" };
      }

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        logger.warn("clone-watch notify: RESEND_API_KEY not set");
        return { skipped: true, reason: "resend_api_key_missing" };
      }

      // Pull Netcraft ref if Layer 2 already submitted — included in body
      // so the brand sees we've already done the community-blocklist step.
      const netcraftUuid = await step.run("read-netcraft-ref", async () => {
        const { data: row } = await sb
          .from("shopfront_clone_alerts")
          .select("submitted_to")
          .eq("id", data.alertId)
          .maybeSingle();
        const submitted_to =
          (row?.submitted_to as Record<string, unknown> | null) ?? {};
        const netcraft = submitted_to.netcraft as
          | { uuid?: string | null }
          | undefined;
        return netcraft?.uuid ?? null;
      });

      const html = await step.run("render-email", () =>
        render(
          CloneWatchBrandAlert({
            brandName: directoryRow.brand,
            legitimateDomain: directoryRow.legitimate_domain,
            candidateDomain: data.candidateDomain,
            candidateUrl: data.candidateUrl,
            signalType: data.signalType,
            score: data.score,
            firstSeenAt: data.triagedAt,
            evidenceSummary: `Surfaced via daily NRD lexical sweep — match score ${data.score.toFixed(2)}, signal ${data.signalType}.`,
            netcraftSubmissionId: netcraftUuid ?? undefined,
          }),
        ),
      );

      const sendResult = await step.run("send-email", async () => {
        const resend = new Resend(apiKey);
        const result = await resend.emails.send({
          from: FROM_EMAIL,
          to: [directoryRow.recipient!],
          replyTo: REPLY_TO_EMAIL,
          subject: `Possible clone of ${directoryRow.brand} — ${data.candidateDomain}`,
          html,
        });
        if (result.error) {
          throw new Error(
            `Resend rejected: ${result.error.message ?? String(result.error)}`,
          );
        }
        return result.data;
      });

      await persistNotification(sb, data.alertId, {
        channel_type: directoryRow.channel_type,
        recipient: directoryRow.recipient,
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: sendResult?.id ?? null,
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_notify_brand",
          provider: "resend",
          operation: directoryRow.channel_type,
          units: 1,
          unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
          metadata: {
            alert_id: data.alertId,
            brand: directoryRow.brand,
            channel_type: directoryRow.channel_type,
            candidate_domain: data.candidateDomain,
            netcraft_uuid: netcraftUuid,
          },
        });
      });

      logger.info("clone-watch notify: email sent", {
        alertId: data.alertId,
        brand: directoryRow.brand,
        channel: directoryRow.channel_type,
        providerMessageId: sendResult?.id,
      });

      return {
        ok: true,
        channel: directoryRow.channel_type,
        sent: true,
        providerMessageId: sendResult?.id,
      };
    }

    return { skipped: true, reason: "unknown_channel_type" };
  },
);

interface NotificationFragment {
  channel_type: string;
  recipient: string | null;
  status: "sent" | "skipped";
  sent_at: string | null;
  provider_message_id?: string | null;
}

async function persistNotification(
  sb: ReturnType<typeof createServiceClient>,
  alertId: number,
  fragment: NotificationFragment,
): Promise<void> {
  if (!sb) return;
  // Atomic JSONB merge via v147 RPC — prevents lost-update races with
  // submit-netcraft (which can run concurrently on the same alert).
  await sb.rpc("merge_clone_alert_submission", {
    p_alert_id: alertId,
    p_key: "brand_notification",
    p_value: { ...fragment, ts: new Date().toISOString() },
    p_set_triage_status: null,
  });
}

interface ManualQueueFragment {
  channel_type: string;
  recipient: string | null;
  queued_at: string;
}

async function persistManualQueue(
  sb: ReturnType<typeof createServiceClient>,
  alertId: number,
  fragment: ManualQueueFragment,
): Promise<void> {
  if (!sb) return;
  await sb.rpc("merge_clone_alert_submission", {
    p_alert_id: alertId,
    p_key: "brand_notification_queued",
    p_value: fragment,
    p_set_triage_status: null,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
