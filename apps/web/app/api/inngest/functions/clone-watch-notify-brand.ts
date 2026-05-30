import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_TRIAGED_EVENT,
  parseCloneWatchTriagedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
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
 *
 * NOTE 2026-05-28: this function no longer calls Resend directly. The
 * email-channel branches enqueue into `clone_alert_notification_queue`;
 * the actual send happens in `clone-watch-notify-brand-prepare` (auto-
 * send) or `/api/admin/clone-watch/batches/[batchId]/send` (dashboard
 * approval). The legacy FROM_EMAIL/REPLY_TO_EMAIL constants were removed
 * with PR-A to avoid a misleading personal-address fallback.
 */

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
  | { kind: "email"; channel: "security_txt" | "fraud_inbox" };

/**
 * Pure routing function — given a directory row, return the action to take.
 * Extracted from the Inngest handler so we can unit-test channel branching
 * without mocking Supabase / Resend / Inngest step machinery.
 *
 * Severity used to gate weekly-digest behaviour for `low` rows. That gate
 * was removed 2026-05-27 because `notify-brand` only fires on
 * `clone.triaged.v1` (admin TP-confirmed). An admin confirming the row
 * means the candidate is a real clone — there is no "noise floor" to
 * batch-protect against. Holding admin-confirmed low-severity rows for
 * the next-Sunday digest was a real UX bug (queue row 8 stuck until
 * 2026-05-31 during the 2026-05-27 e2e test). Severity stays in the
 * function signature so the type contract is unchanged; the parameter is
 * now informational (used for cooldown logging downstream, not routing).
 */
export function decideNotificationAction(
  row: DirectoryRow | null,
  _severity: SeverityTier = "medium",
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
    return { kind: "email", channel: row.channel_type };
  }
  return { kind: "skip", reason: "unknown_channel_type" };
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
  withAxiomLogging({ fnId: "shopfront-clone-notify-brand" }, async ({ event, step }) => {
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

      // PR-B2 — never send immediately. Always enqueue into
      // clone_alert_notification_queue and let the daily batch-builder
      // cron group + Telegram-preview to the admin for approval.
      // One email per brand per day, not N. The admin clicks an HMAC
      // approve URL to authorise the actual send (FF_SHOPFRONT_CLONE_-
      // NOTIFY_BRAND_AUTO_SEND lifts that gate once the template is
      // validated).
      //
      // Suppression check still runs first so STOP-replied recipients
      // never even hit the queue.
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

      const severity = (data.severityTier as SeverityTier) ?? "medium";
      // All severities: schedule for now(). The daily-batch builder picks
      // up `scheduled_for <= now()` and groups by (brand, recipient), so
      // multiple low-severity alerts for the same brand still consolidate
      // into one email at the next 09:30 UTC cron tick. The previous
      // "low → next Sunday weekly digest" branch was removed 2026-05-27 —
      // this handler only fires post-admin-TP-confirm, so the noise-floor
      // concern doesn't apply (admin already filtered the noise).
      const scheduledFor = new Date();

      await step.run("enqueue-for-batch", async () => {
        await sb.rpc("enqueue_clone_alert_notification", {
          p_alert_id: data.alertId,
          p_brand: directoryRow.brand,
          p_candidate_domain: data.candidateDomain,
          p_candidate_url: data.candidateUrl,
          p_recipient: directoryRow.recipient!,
          p_channel_type: directoryRow.channel_type,
          p_severity_tier: severity,
          p_scheduled_for: scheduledFor.toISOString(),
        });
      });

      await step.run("persist-notification-enqueued", async () => {
        await persistNotification(sb, data.alertId, {
          channel_type: directoryRow.channel_type,
          recipient: directoryRow.recipient,
          status: "skipped", // not yet 'sent' — batch builder will update
          sent_at: null,
        });
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_notify_brand",
          provider: "queue",
          operation: "enqueue",
          units: 0,
          unitCostUsd: 0,
          metadata: {
            alert_id: data.alertId,
            brand: directoryRow.brand,
            channel_type: directoryRow.channel_type,
            severity_tier: severity,
            scheduled_for: scheduledFor.toISOString(),
          },
        });
      });

      logger.info("clone-watch notify: enqueued for batch", {
        alertId: data.alertId,
        brand: directoryRow.brand,
        channel: directoryRow.channel_type,
        severity,
        scheduled_for: scheduledFor.toISOString(),
      });

      return {
        ok: true,
        channel: directoryRow.channel_type,
        enqueued: true,
        severity,
      };
    }

    return { skipped: true, reason: "unknown_channel_type" };
  }),
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
