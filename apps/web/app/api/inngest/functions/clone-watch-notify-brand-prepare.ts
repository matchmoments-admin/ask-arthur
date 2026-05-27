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
 * 3. Filters out brands we already notified inside the cooldown window
 *    (default 24h, via brand_contact_directory.last_notified_at). Skipped
 *    rows stay in 'unbatched' for the next day's run.
 * 4. Caps each batch at MAX_CANDIDATES_PER_BATCH (50). If a single
 *    (brand, recipient) group exceeds the cap, the oldest 50 ship today
 *    and the remainder roll over to tomorrow.
 * 5. For each batch:
 *      - mints a fresh batch_id (uuid, inside step.run so it survives
 *        Inngest replays — see PR #456)
 *      - renders the email body via React Email
 *      - stores rendered subject + html on the queue rows so the dashboard
 *        sends EXACTLY what was previewed (no template drift)
 *      - transitions rows to 'pending' approval state
 * 6. After the loop, fires ONE summary Telegram pointing the admin at the
 *    dashboard (replaces the old per-batch HMAC-URL preview, which was
 *    auto-clicked by Telegram's link-preview crawler — incident
 *    2026-05-26). Per-batch Send/Reject buttons live in
 *    /admin/clone-watch#approvals.
 * 7. When FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND is ON, the loop skips
 *    the dashboard step and sends via Resend immediately (marks rows
 *    'auto_approved' → 'sent'). Default OFF until the matcher's false-
 *    positive rate is calibrated.
 *
 * Cron: 09:30 UTC daily (after the 08:30 UTC NRD ingest settles).
 * Gated by FF_SHOPFRONT_CLONE_OUTREACH + FF_SHOPFRONT_CLONE_NOTIFY_BRAND.
 *
 * Hardening pass v152 (2026-05-27):
 *   • Pre-check feature_brakes.shopfront_clone_outreach
 *   • Per-brand 24h cooldown (no daily fatigue for watchlisted brands)
 *   • Max 50 candidates per batch (no 400-row mega-emails)
 *   • RESEND_FROM_EMAIL: fail closed if env unset (was defaulting to a
 *     personal-looking sender)
 *   • Telegram summary surfaces groupsFailed + groupsSkipped counts
 *   • Recipient hashed in log lines
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

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const REPLY_TO_EMAIL = "brendan@askarthur.au";
const DASHBOARD_URL = "https://askarthur.au/admin/clone-watch#approvals";
const BRAND_COOLDOWN_HOURS = 24;
const MAX_CANDIDATES_PER_BATCH = 50;

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

    // Cost brake — if the daily-spend brake is engaged, skip the whole run.
    const brakeEngaged = await step.run("check-brake", async () => {
      const { data, error } = await sb
        .from("feature_brakes")
        .select("paused_until")
        .eq("feature", "shopfront_clone_outreach")
        .maybeSingle();
      if (error) {
        logger.warn("clone-watch prepare: brake lookup failed", {
          error: error.message,
        });
        return true; // conservative
      }
      return Boolean(
        data?.paused_until && new Date(data.paused_until).getTime() > Date.now(),
      );
    });
    if (brakeEngaged) {
      await step.run("notify-brake-engaged", async () => {
        await sendAdminTelegramMessage(
          [
            "🛑 <b>Clone-watch prepare skipped</b>",
            "",
            "<code>feature_brakes.shopfront_clone_outreach</code> is engaged.",
            "No batches prepared. Resume when the brake clears.",
          ].join("\n"),
        );
      });
      return { skipped: true, reason: "cost_brake_engaged" };
    }

    if (!FROM_EMAIL) {
      logger.error("clone-watch prepare: RESEND_FROM_EMAIL unset");
      return { skipped: true, reason: "resend_from_email_unset" };
    }

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

    const allGroups = groupByBrandRecipient(rows);

    // Per-brand cooldown filter. Skipped brands roll over to next run.
    const cooldownBrands = await step.run(
      "check-brand-cooldown",
      async () => {
        const legitimateDomains = allGroups.map((g) => g.brand);
        const { data, error } = await sb.rpc(
          "list_recently_notified_brands",
          {
            p_legitimate_domains: legitimateDomains,
            p_cooldown_hours: BRAND_COOLDOWN_HOURS,
          },
        );
        if (error) {
          logger.warn("clone-watch prepare: cooldown lookup failed", {
            error: error.message,
          });
          return [];
        }
        return ((data as Array<{ legitimate_domain: string }> | null) ?? []).map(
          (r) => r.legitimate_domain,
        );
      },
    );
    const cooldownSet = new Set(cooldownBrands);
    const groups = allGroups.filter((g) => !cooldownSet.has(g.brand));
    const groupsSkippedCooldown = allGroups.length - groups.length;

    if (groups.length === 0) {
      logger.info("clone-watch prepare: all brands within cooldown", {
        skipped: groupsSkippedCooldown,
      });
      return {
        ok: true,
        batches_prepared: 0,
        groups_skipped_cooldown: groupsSkippedCooldown,
        reason: "all_brands_within_cooldown",
      };
    }

    // Cap candidates per batch. Oldest 50 ship today; remainder stays
    // unbatched for tomorrow.
    const cappedGroups = groups.map((g) => ({
      ...g,
      rows: g.rows
        .slice()
        .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
        .slice(0, MAX_CANDIDATES_PER_BATCH),
    }));

    const autoSend = featureFlags.shopfrontCloneNotifyBrandAutoSend;

    let batchesPrepared = 0;
    let autoSent = 0;
    let groupsFailed = 0;

    for (const group of cappedGroups) {
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
                const result = await resend.emails.send(
                  {
                    from: FROM_EMAIL,
                    to: [group.recipient],
                    replyTo: REPLY_TO_EMAIL,
                    subject,
                    html,
                  },
                  { idempotencyKey: `clone-watch-send:${batchId}` },
                );
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
                p_admin_id: null,
              });
              if (error) {
                throw new Error(
                  `transition_clone_alert_batch: ${error.message}`,
                );
              }
            });
            await step.run(`record-sent-${batchId}`, async () => {
              const { error } = await sb.rpc(
                "record_brand_notification_sent",
                {
                  p_batch_id: batchId,
                  p_provider_message_id: sendResult?.id ?? null,
                },
              );
              if (error) {
                logger.warn(
                  "clone-watch prepare: record_brand_notification_sent failed",
                  { batchId, error: error.message },
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
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    // Fire ONE summary Telegram to the admin chat if we created any new
    // manual-approval batches OR anything failed/was skipped (so silent
    // failures don't hide).
    const pendingNew = batchesPrepared - autoSent;
    if (pendingNew > 0 || groupsFailed > 0 || groupsSkippedCooldown > 0) {
      await step.run("notify-admin-summary", async () => {
        await sendAdminTelegramMessage(
          buildTelegramSummaryMessage({
            batchesPrepared: pendingNew,
            groupsFailed,
            groupsSkippedCooldown,
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
          groups_failed: groupsFailed,
          groups_skipped_cooldown: groupsSkippedCooldown,
        },
      });
    }

    logger.info("clone-watch notify-brand prepare: done", {
      batches: batchesPrepared,
      auto_sent: autoSent,
      groups_failed: groupsFailed,
      groups_skipped_cooldown: groupsSkippedCooldown,
      mode: autoSend ? "auto_send" : "manual_approval",
    });

    return {
      ok: true,
      batches_prepared: batchesPrepared,
      auto_sent: autoSent,
      groups_failed: groupsFailed,
      groups_skipped_cooldown: groupsSkippedCooldown,
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
 * Summary Telegram posted ONCE per prepare run. The dashboard URL is the
 * only link — clicking it from Telegram is safe because the dashboard
 * requires admin auth.
 *
 * Surfaces three counters so silent failures + cooldown-skips don't hide:
 *   • batchesPrepared    — awaiting Send in the dashboard
 *   • groupsFailed       — rendered/assigned threw; will retry tomorrow
 *   • groupsSkipped      — within 24h cooldown; roll over to tomorrow
 */
export function buildTelegramSummaryMessage(args: {
  batchesPrepared: number;
  groupsFailed: number;
  groupsSkippedCooldown: number;
  dashboardUrl: string;
}): string {
  const lines = [`🛡️ <b>Clone-watch — prepare summary</b>`, ``];
  if (args.batchesPrepared > 0) {
    const noun = args.batchesPrepared === 1 ? "batch" : "batches";
    lines.push(
      `<b>${args.batchesPrepared}</b> ${noun} awaiting your approval.`,
    );
  } else {
    lines.push(`No new batches awaiting approval.`);
  }
  if (args.groupsSkippedCooldown > 0) {
    lines.push(
      `${args.groupsSkippedCooldown} brand${args.groupsSkippedCooldown === 1 ? "" : "s"} skipped (24h cooldown — roll over to next run).`,
    );
  }
  if (args.groupsFailed > 0) {
    lines.push(`⚠️ ${args.groupsFailed} group${args.groupsFailed === 1 ? "" : "s"} failed during render/assign (check logs).`);
  }
  lines.push(
    ``,
    `Review and send at <a href="${args.dashboardUrl}">${args.dashboardUrl}</a>`,
  );
  return lines.join("\n");
}
