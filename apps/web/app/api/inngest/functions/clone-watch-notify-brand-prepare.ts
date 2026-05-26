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
import { buildBatchApprovalUrl } from "@/lib/clone-watch-approve";
import { logCost, PRICING } from "@/lib/cost-telemetry";

/**
 * PR-B2 — Daily batch builder for clone-watch brand notifications.
 *
 * 1. Pulls all queue rows in 'unbatched' state where scheduled_for <= now()
 * 2. Groups by (brand, recipient) — each group becomes ONE consolidated
 *    email instead of N separate emails (user feedback 2026-05-26)
 * 3. For each group:
 *      - assigns a fresh batch_id (uuid)
 *      - renders the email body via React Email
 *      - stores rendered subject + html on the queue rows so the approve
 *        endpoint sends EXACTLY what was previewed (no template drift)
 *      - transitions rows to 'pending' approval state
 *      - sends a Telegram preview to admin with the full body + an
 *        HMAC-signed approve URL + reject URL
 * 4. When FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND is ON, the prepare
 *    cron skips the Telegram step and sends directly (marks rows
 *    'auto_approved' → 'sent'). Default OFF until template is validated.
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

export const cloneWatchNotifyBrandPrepare = inngest.createFunction(
  {
    id: "shopfront-clone-notify-brand-prepare",
    name: "Clone-Watch: Daily batch builder + Telegram approval preview",
    retries: 2,
    // singleton (key defaults to fn id) replaces the legacy `concurrency:
    // { limit: 1 }` shape — same "no overlapping runs" guarantee, but the
    // slot releases cleanly on cancel/timeout/error. The legacy form left a
    // phantom slot held by an early cancelled smoke-test run, which masked
    // every subsequent manual trigger as `function_version: 0 / no step
    // progress`. `mode: "skip"` is correct because this cron is idempotent
    // — the next 09:30 UTC sweep picks up any rows the skipped run would
    // have processed.
    singleton: { mode: "skip" },
    timeouts: { finish: "10m" },
  },
  [
    { cron: "30 9 * * *" },
    { event: "shopfront/clone.notify-brand-prepare.manual-trigger.v1" },
  ],
  async ({ step }) => {
    // Entry breadcrumb — cheap Vercel-log line that proves dispatch reached
    // the route. Splits "Inngest never called Vercel" from "Vercel ran but
    // crashed silently" in any future hang investigation.
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
      // Per-group try/catch — one bad render/RPC/Telegram call no longer
      // drops the remaining N-1 groups. Mirrors the urlscan-fan-out guard
      // in shopfront-nrd-daily-ingest.ts.
      try {
        // Mint the batchId INSIDE a step.run so it's memoised across
        // Inngest replays. crypto.randomUUID() is non-deterministic —
        // if it ran in the plain function body, every replay would
        // generate a new UUID, every downstream step key
        // (`render-batch-${batchId}`, `assign-batch-${batchId}`, ...)
        // would change, Inngest's SHA-1-hashed step cache would never
        // hit, and the same steps would re-execute on every replay
        // until the 10-minute function timeout. The mint step's key is
        // stable because the group key is derived from the memoised
        // load-unbatched result.
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

        // URL build runs INSIDE the assign-batch step so a missing
        // CLONE_WATCH_APPROVAL_SECRET / ADMIN_SECRET surfaces as a step-
        // level retry/failure with a clear log — not an opaque function
        // crash before any step ran. Returns both URLs so the Telegram
        // step downstream uses the same values.
        const { approveUrl, rejectUrl } = await step.run(
          `assign-batch-${batchId}`,
          async () => {
            const approveUrl = buildBatchApprovalUrl(
              "approve",
              batchId,
              group.brand,
              group.recipient,
            );
            const rejectUrl = buildBatchApprovalUrl(
              "reject",
              batchId,
              group.brand,
              group.recipient,
            );
            const { error } = await sb.rpc("assign_clone_alert_batch", {
              p_queue_ids: group.rows.map((r) => r.id),
              p_batch_id: batchId,
              p_email_subject: subject,
              p_email_body_html: html,
              p_approval_url: approveUrl,
              p_auto_approved: autoSend,
            });
            if (error) {
              throw new Error(`assign_clone_alert_batch: ${error.message}`);
            }
            return { approveUrl, rejectUrl };
          },
        );

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
            // logCost is fire-and-forget via waitUntil — wrapping it in
            // step.run adds no durability and risks the waitUntil being
            // killed at the step boundary.
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
        } else {
          // Telegram approval-preview path.
          await step.run(`telegram-preview-${batchId}`, async () => {
            await sendAdminTelegramMessage(
              buildTelegramApprovalMessage({
                brand: group.brand,
                recipient: group.recipient,
                candidateCount: candidates.length,
                candidateDomains: candidates.map((c) => c.candidateDomain),
                subject,
                approveUrl,
                rejectUrl,
              }),
            );
          });
          logCost({
            feature: "shopfront_clone_notify_brand_prepare",
            provider: "telegram",
            operation: "approval_preview",
            units: 0,
            unitCostUsd: 0,
            metadata: {
              batch_id: batchId,
              brand: group.brand,
              candidate_count: candidates.length,
            },
          });
        }
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

export function buildTelegramApprovalMessage(args: {
  brand: string;
  recipient: string;
  candidateCount: number;
  candidateDomains: string[];
  subject: string;
  approveUrl: string;
  rejectUrl: string;
}): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const domainList = args.candidateDomains
    .slice(0, 10)
    .map((d) => `· <code>${escape(d)}</code>`)
    .join("\n");
  const extra =
    args.candidateDomains.length > 10
      ? `\n…and ${args.candidateDomains.length - 10} more`
      : "";
  return [
    `🛡️ <b>Clone-watch — batch ready for approval</b>`,
    ``,
    `Brand: <b>${escape(args.brand)}</b>`,
    `Recipient: <code>${escape(args.recipient)}</code>`,
    `Subject: ${escape(args.subject)}`,
    `Candidates: <b>${args.candidateCount}</b>`,
    ``,
    domainList + extra,
    ``,
    `✅ <a href="${args.approveUrl}">Approve + send</a>`,
    `❌ <a href="${args.rejectUrl}">Reject</a>`,
    ``,
    `<i>Approve URL is HMAC-signed and locked to this batch_id + brand + recipient. Single use.</i>`,
  ].join("\n");
}
