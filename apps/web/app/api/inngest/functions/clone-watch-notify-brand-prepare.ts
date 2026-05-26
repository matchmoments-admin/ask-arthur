import crypto from "crypto";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { render } from "@react-email/components";
import { Resend } from "resend";
import CloneWatchBrandAlert, {
  type CloneWatchCandidate,
} from "@/emails/CloneWatchBrandAlert";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { logCost, PRICING } from "@/lib/cost-telemetry";

/**
 * Daily batch builder for clone-watch brand notifications.
 *
 * 1. Pulls all queue rows in 'unbatched' state where scheduled_for <= now()
 * 2. Groups by (brand, recipient) — each group becomes ONE consolidated
 *    email instead of N separate emails (user feedback 2026-05-26)
 * 3. For each group:
 *      - mints a fresh batch_id (uuid, inside step.run so it survives
 *        Inngest replays — see PR #456)
 *      - renders the email body via React Email
 *      - stores rendered subject + html on the queue rows so the dashboard
 *        sends EXACTLY what was previewed (no template drift)
 *      - transitions rows to 'pending' approval state
 * 4. After the loop, fires ONE summary Telegram pointing the admin at the
 *    dashboard (replaces the old per-batch HMAC-URL preview, which was
 *    auto-clicked by Telegram's link-preview crawler — incident
 *    2026-05-26). Per-batch Send/Reject buttons live in
 *    /admin/clone-watch#approvals.
 * 5. When FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND is ON, the loop skips
 *    the dashboard step and sends via Resend immediately (marks rows
 *    'auto_approved' → 'sent'). Default OFF until the matcher's false-
 *    positive rate is calibrated.
 *
 * Cron: 09:30 UTC daily (after the 08:30 UTC NRD ingest settles).
 * Gated by FF_SHOPFRONT_CLONE_OUTREACH + FF_SHOPFRONT_CLONE_NOTIFY_BRAND.
 *
 * See docs/plans/clone-watch-outreach.md.
 */

interface UnbatchedRow {
  id: number;
  alert_id: number;
  brand: string;
  candidate_domain: string;
  candidate_url: string;
  recipient: string;
  channel_type: string;
  severity_tier: string;
  enqueued_at: string;
}

interface BrandGroup {
  brand: string;
  recipient: string;
  channel_type: string;
  rows: UnbatchedRow[];
}

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <brendan@askarthur.au>";
const REPLY_TO_EMAIL = "brendan@askarthur.au";
const DASHBOARD_URL = "https://askarthur.au/admin/clone-watch#approvals";

export const cloneWatchNotifyBrandPrepare = inngest.createFunction(
  {
    id: "shopfront-clone-notify-brand-prepare",
    name: "Clone-Watch: Daily batch builder + dashboard summary",
    retries: 2,
    // singleton (key defaults to fn id) replaces the legacy `concurrency:
    // { limit: 1 }` shape — same "no overlapping runs" guarantee, but the
    // slot releases cleanly on cancel/timeout/error. See PR #455.
    singleton: { mode: "skip" },
    timeouts: { finish: "10m" },
  },
  [
    { cron: "30 9 * * *" },
    { event: "shopfront/clone.notify-brand-prepare.manual-trigger.v1" },
  ],
  async ({ step }) => {
    logger.info("clone-watch prepare: invoked", {
      autoSend: featureFlags.shopfrontCloneNotifyBrandAutoSend,
    });

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
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    const rows = await step.run("load-unbatched", async () => {
      const { data, error } = await sb.rpc(
        "list_clone_alerts_unbatched_for_prepare",
        { p_limit: 500 },
      );
      if (error) {
        throw new Error(`list_unbatched rpc: ${error.message}`);
      }
      return (data as UnbatchedRow[] | null) ?? [];
    });

    if (rows.length === 0) {
      return { ok: true, batches_prepared: 0, reason: "no_unbatched_rows" };
    }

    const groups = groupByBrandRecipient(rows);
    const autoSend = featureFlags.shopfrontCloneNotifyBrandAutoSend;

    let batchesPrepared = 0;
    let autoSent = 0;
    let groupsFailed = 0;

    for (const group of groups) {
      try {
        const groupKey = `${group.brand}::${group.recipient}`;
        const batchId = await step.run(
          `mint-batch-id:${groupKey}`,
          async () => crypto.randomUUID(),
        );
        const candidates: CloneWatchCandidate[] = group.rows.map((r) => ({
          candidateDomain: r.candidate_domain,
          candidateUrl: r.candidate_url,
          signalType: "lexical",
          score: 0,
          firstSeenAt: r.enqueued_at,
          evidenceSummary: `Surfaced via daily NRD lexical sweep (severity ${r.severity_tier}).`,
        }));

        const legitimateDomain = group.brand;
        const subject = buildBatchSubject(group);
        const html = await step.run(`render-batch-${batchId}`, async () => {
          return render(
            CloneWatchBrandAlert({
              brandName: legitimateDomain,
              legitimateDomain,
              candidates,
              reportRef: `CW-batch-${batchId}`,
            }),
          );
        });

        await step.run(`assign-batch-${batchId}`, async () => {
          // approval_url is no longer a load-bearing URL — kept as an
          // empty string for schema compatibility. The dashboard
          // (/admin/clone-watch#approvals) is the only approval surface.
          const { error } = await sb.rpc("assign_clone_alert_batch", {
            p_queue_ids: group.rows.map((r) => r.id),
            p_batch_id: batchId,
            p_email_subject: subject,
            p_email_body_html: html,
            p_approval_url: "",
            p_auto_approved: autoSend,
          });
          if (error) {
            throw new Error(`assign_clone_alert_batch: ${error.message}`);
          }
        });

        if (autoSend) {
          // Auto-approve path: send via Resend immediately, mark sent.
          const apiKey = process.env.RESEND_API_KEY;
          if (!apiKey) {
            logger.warn(
              "clone-watch prepare: RESEND_API_KEY missing in auto-send mode",
            );
          } else {
            const sendResult = await step.run(
              `auto-send-${batchId}`,
              async () => {
                const resend = new Resend(apiKey);
                const result = await resend.emails.send({
                  from: FROM_EMAIL,
                  to: [group.recipient],
                  replyTo: REPLY_TO_EMAIL,
                  subject,
                  html,
                });
                if (result.error) {
                  throw new Error(
                    `Resend rejected: ${result.error.message ?? String(result.error)}`,
                  );
                }
                return result.data;
              },
            );
            await step.run(`mark-sent-${batchId}`, async () => {
              const { error } = await sb.rpc("transition_clone_alert_batch", {
                p_batch_id: batchId,
                p_new_status: "sent",
                p_provider_message_id: sendResult?.id ?? null,
              });
              if (error) {
                throw new Error(
                  `transition_clone_alert_batch: ${error.message}`,
                );
              }
            });
            logCost({
              feature: "shopfront_clone_notify_brand",
              provider: "resend",
              operation: "auto_send",
              units: 1,
              unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
              metadata: {
                batch_id: batchId,
                brand: group.brand,
                recipient: group.recipient,
                candidate_count: candidates.length,
                provider_message_id: sendResult?.id ?? null,
              },
            });
            autoSent++;
          }
        }
        // Manual-approval path: no per-batch Telegram. Just the row
        // transitions to 'pending' via the assign step above. The
        // summary Telegram fires once at the end of the loop pointing
        // admins at the dashboard.
        batchesPrepared++;
      } catch (err) {
        groupsFailed++;
        logger.error("clone-watch prepare: group failed", {
          brand: group.brand,
          recipient: group.recipient,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    // Fire ONE summary Telegram to the admin chat if we created any new
    // manual-approval batches. Auto-sent batches don't need this surface —
    // the email is already on its way to the recipient.
    const pendingNew = batchesPrepared - autoSent;
    if (pendingNew > 0) {
      await step.run("notify-admin-summary", async () => {
        await sendAdminTelegramMessage(
          buildTelegramSummaryMessage({
            batchesPrepared: pendingNew,
            dashboardUrl: DASHBOARD_URL,
          }),
        );
      });
      logCost({
        feature: "shopfront_clone_notify_brand_prepare",
        provider: "telegram",
        operation: "summary_notification",
        units: 0,
        unitCostUsd: 0,
        metadata: {
          batches_prepared: batchesPrepared,
          pending_for_approval: pendingNew,
          auto_sent: autoSent,
        },
      });
    }

    logger.info("clone-watch notify-brand prepare: done", {
      batches: batchesPrepared,
      auto_sent: autoSent,
      groups_failed: groupsFailed,
      mode: autoSend ? "auto_send" : "manual_approval",
    });

    return {
      ok: true,
      batches_prepared: batchesPrepared,
      auto_sent: autoSent,
      groups_failed: groupsFailed,
      mode: autoSend ? "auto_send" : "manual_approval",
    };
  },
);

// ── Pure helpers (exported for unit testing) ─────────────────────────────

export function groupByBrandRecipient(rows: UnbatchedRow[]): BrandGroup[] {
  const map = new Map<string, BrandGroup>();
  for (const row of rows) {
    const key = `${row.brand}::${row.recipient}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      map.set(key, {
        brand: row.brand,
        recipient: row.recipient,
        channel_type: row.channel_type,
        rows: [row],
      });
    }
  }
  return Array.from(map.values());
}

export function buildBatchSubject(group: BrandGroup): string {
  if (group.rows.length === 1) {
    return `Possible clone of ${group.brand} — ${group.rows[0].candidate_domain}`;
  }
  return `${group.rows.length} possible clones of ${group.brand} — ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Summary Telegram posted ONCE per prepare run. Replaces the old per-batch
 * HMAC-URL preview that was auto-clicked by Telegram's link-preview
 * crawler. The dashboard URL is the only link — clicking it from Telegram
 * is safe because the dashboard requires admin auth.
 */
export function buildTelegramSummaryMessage(args: {
  batchesPrepared: number;
  dashboardUrl: string;
}): string {
  const noun = args.batchesPrepared === 1 ? "batch" : "batches";
  return [
    `🛡️ <b>Clone-watch — prepare summary</b>`,
    ``,
    `<b>${args.batchesPrepared}</b> ${noun} awaiting your approval.`,
    ``,
    `Review and send at <a href="${args.dashboardUrl}">${args.dashboardUrl}</a>`,
  ].join("\n");
}
