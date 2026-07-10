import crypto from "crypto";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_WEAPONISED_EVENT,
  parseCloneWatchWeaponisedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { render } from "@react-email/components";
import WeaponisedCloneAlert, {
  type WeaponisedCloneAlertProps,
} from "@/emails/WeaponisedCloneAlert";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { logCost } from "@/lib/cost-telemetry";
import { resolveEmailCopy } from "@/lib/email/resolve-copy";
import {
  decideNotificationAction,
  type DirectoryRow,
} from "./clone-watch-notify-brand";
import { urlscanEvidenceFromJsonb } from "./clone-watch-notify-brand-prepare";

/**
 * F1 — weaponisation early-warning brand alert.
 *
 * Second consumer of shopfront/clone.weaponised.v1 (alongside
 * clone-watch-enforcement-plan, which opens INTERNAL takedown cases). This
 * one tells the BRAND: the lookalike we were monitoring has flipped to
 * serving suspected phishing content — the moment the brand is under
 * active attack and the most time-sensitive signal clone-watch produces.
 *
 * Flow: load the alert row (the event payload is deliberately thin) →
 * resolve the brand contact via brand_contact_directory (same seam as the
 * routine notify-brand) → STOP-suppression check → enqueue ONE urgent
 * queue row (kind='weaponised', v220 — a separate partial-unique lane so a
 * clone already brand-notified at triage time can still stage an urgent
 * alert weeks later) → render + stage a single-alert 'pending' batch
 * IMMEDIATELY (bypassing the daily prepare cron and its 24h brand
 * cooldown) → Telegram-page the admin. The actual send is the existing
 * four-eyes dashboard route, unchanged — it re-checks STOP, cross-
 * validates the recipient, and stamps the brand cooldown.
 *
 * ALWAYS four-eyes (p_auto_approved hard-coded false), even when the
 * routine FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND flag is ON.
 *
 * Dedup: one brand alert per alertId ever — Inngest idempotency covers the
 * 24h window (the emitter id-keys per (alertId, via), so initial+recheck
 * are distinct events), the submitted_to.weaponised_notification stamp
 * covers forever, and the v220 partial unique index is the DB backstop.
 *
 * Gated FF_CLONE_WEAPONISED_ALERT under FF_SHOPFRONT_CLONE_OUTREACH.
 * See docs/plans/clone-watch-brand-value-features.md §F1.
 */

const DASHBOARD_URL = "https://askarthur.au/admin/clone-watch#approvals";

interface WeaponisedAlertRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  inferred_target_domain: string | null;
  target_brand_normalized: string | null;
  lifecycle_state: string;
  weaponised_at: string | null;
  netcraft_declined_at: string | null;
  urlscan_evidence: unknown;
  attribution: unknown;
  submitted_to: Record<string, unknown> | null;
}

export const cloneWatchNotifyWeaponised = inngest.createFunction(
  {
    id: "shopfront-clone-notify-weaponised",
    name: "Clone-Watch: weaponisation early-warning (brand alert)",
    retries: 3,
    concurrency: { limit: 2 },
    idempotency: "event.data.alertId",
    timeouts: { finish: "3m" },
  },
  { event: CLONE_WATCH_WEAPONISED_EVENT },
  withAxiomLogging(
    { fnId: "shopfront-clone-notify-weaponised" },
    async ({ event, step }) => {
      const data = parseCloneWatchWeaponisedData(event.data);

      if (!featureFlags.shopfrontCloneOutreach) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
      }
      if (!featureFlags.cloneWeaponisedAlert) {
        return { skipped: true, reason: "FF_CLONE_WEAPONISED_ALERT disabled" };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Cost brake — shares the outreach brake with the routine sends.
      const brakeEngaged = await step.run("check-brake", async () => {
        const { data: brake, error } = await sb
          .from("feature_brakes")
          .select("paused_until")
          .eq("feature", "shopfront_clone_outreach")
          .maybeSingle();
        if (error) {
          logger.warn("clone-watch weaponised: brake lookup failed", {
            error: error.message,
          });
          return true; // conservative
        }
        return Boolean(
          brake?.paused_until &&
            new Date(brake.paused_until).getTime() > Date.now(),
        );
      });
      if (brakeEngaged) {
        return { skipped: true, reason: "cost_brake_engaged" };
      }

      // The event payload is thin by design — reload the row for evidence.
      const alert = await step.run("load-alert", async () => {
        const { data: row, error } = await sb
          .from("shopfront_clone_alerts")
          .select(
            "id, candidate_domain, candidate_url, inferred_target_domain, target_brand_normalized, lifecycle_state, weaponised_at, netcraft_declined_at, urlscan_evidence, attribution, submitted_to",
          )
          .eq("id", data.alertId)
          .maybeSingle();
        if (error) throw new Error(`load alert: ${error.message}`);
        return row as WeaponisedAlertRow | null;
      });
      if (!alert) {
        return { skipped: true, reason: "alert_not_found" };
      }
      // Stale replay guard: if the state has already moved past weaponised
      // (e.g. taken_down), an "under attack right now" alert would be false.
      if (alert.lifecycle_state !== "weaponised") {
        return {
          skipped: true,
          reason: "lifecycle_state_moved_on",
          lifecycle_state: alert.lifecycle_state,
        };
      }

      // Forever-dedup: one urgent brand alert per clone, across via values
      // and beyond Inngest's 24h idempotency window.
      const submittedTo = alert.submitted_to ?? {};
      if (submittedTo.weaponised_notification) {
        return { skipped: true, reason: "already_notified" };
      }

      const directoryRow = await step.run("load-brand-contact", async () => {
        if (!alert.inferred_target_domain) return null;
        const { data: rows } = await sb
          .from("brand_contact_directory")
          .select(
            "brand, legitimate_domain, channel_type, recipient, evidence_format, notes",
          )
          .eq("legitimate_domain", alert.inferred_target_domain)
          .maybeSingle();
        return rows as DirectoryRow | null;
      });

      // monitored_brands tag-along (telemetry only — zero rows in prod
      // today and no contact email column; org-email routing is a
      // follow-up, see the plan doc).
      const monitoredBrand = await step.run("monitored-brand-tag", async () => {
        if (!alert.target_brand_normalized) return null;
        const { data: row } = await sb
          .from("monitored_brands")
          .select("id, plan")
          .eq("brand_normalized", alert.target_brand_normalized)
          .eq("is_active", true)
          .eq("verification_status", "verified")
          .maybeSingle();
        return row as { id: number; plan: string } | null;
      });

      const action = decideNotificationAction(directoryRow, "critical");
      const urlscanEvidence = urlscanEvidenceFromJsonb(alert.urlscan_evidence);

      // Non-email outcomes: unlike the routine notify flow, a weaponisation
      // ALWAYS pages the admin — it's rare and high-value, and "we knew and
      // nobody looked" is the failure mode this feature exists to prevent.
      if (action.kind !== "email") {
        await step.run("telegram-admin-manual", async () => {
          await sendAdminTelegramMessage(
            buildWeaponisedTelegramMessage({
              stage: action.kind === "skip" ? "no_contact" : "manual_channel",
              brand: directoryRow?.brand ?? alert.inferred_target_domain ?? "?",
              candidateDomain: alert.candidate_domain,
              via: data.via,
              urlscanResultUrl: urlscanEvidence?.resultUrl,
              channelType: directoryRow?.channel_type,
              recipient: directoryRow?.recipient ?? undefined,
              detail: action.kind === "skip" ? action.reason : action.channel,
            }),
          );
        });
        await step.run("stamp-manual", async () => {
          await sb.rpc("merge_clone_alert_submission", {
            p_alert_id: alert.id,
            p_key: "weaponised_notification",
            p_value: {
              status: action.kind === "skip" ? "skipped" : "manual_queued",
              reason: action.kind === "skip" ? action.reason : action.channel,
              via: data.via,
              at: new Date().toISOString(),
            },
            p_set_triage_status: null,
          });
        });
        logger.warn("clone-watch: weaponised alert has no email channel", {
          alertId: alert.id,
          brand: alert.inferred_target_domain,
          outcome: action.kind === "skip" ? action.reason : action.channel,
          via: data.via,
        });
        return {
          ok: true,
          outcome: action.kind,
          detail: action.kind === "skip" ? action.reason : action.channel,
        };
      }

      // Email channel — STOP suppression first, same as the routine flow.
      const recipient = directoryRow!.recipient!;
      const suppressed = await step.run("check-suppression", async () => {
        const { data: hit } = await sb.rpc("clone_alert_recipient_is_suppressed", {
          p_email: recipient,
        });
        return Boolean(hit);
      });
      if (suppressed) {
        await step.run("stamp-suppressed", async () => {
          await sb.rpc("merge_clone_alert_submission", {
            p_alert_id: alert.id,
            p_key: "weaponised_notification",
            p_value: {
              status: "skipped",
              reason: "recipient_stop_suppressed",
              via: data.via,
              at: new Date().toISOString(),
            },
            p_set_triage_status: null,
          });
        });
        return { skipped: true, reason: "recipient_stop_suppressed" };
      }

      // Enqueue the ONE urgent row (kind='weaponised', v220).
      const enqueue = await step.run("enqueue-weaponised", async () => {
        const { data: rows, error } = await sb.rpc(
          "enqueue_weaponised_clone_alert_notification",
          {
            p_alert_id: alert.id,
            p_brand: directoryRow!.brand,
            p_candidate_domain: alert.candidate_domain,
            p_candidate_url: alert.candidate_url,
            p_recipient: recipient,
            p_channel_type: directoryRow!.channel_type,
          },
        );
        if (error) throw new Error(`enqueue_weaponised: ${error.message}`);
        const row = (rows as Array<{ queue_id: number; inserted: boolean }>)[0];
        if (!row) throw new Error("enqueue_weaponised returned no row");
        return row;
      });
      if (!enqueue.inserted) {
        // A prior run already enqueued (and likely staged) this alert.
        return { skipped: true, reason: "already_queued", queueId: enqueue.queue_id };
      }

      // Mint inside step.run so it survives Inngest replays (PR #456).
      const batchId = await step.run("mint-batch-id", async () =>
        crypto.randomUUID(),
      );

      const reportRef = `CW-weaponised-${alert.id}`;
      const subject = buildWeaponisedSubject(
        directoryRow!.brand,
        alert.candidate_domain,
      );
      const html = await step.run("render", async () => {
        const copy = await resolveEmailCopy("weaponised_clone_alert");
        return render(
          WeaponisedCloneAlert(
            buildWeaponisedAlertProps(alert, {
              brandName: directoryRow!.brand,
              reportRef,
              copy,
              urlscanResultUrl: urlscanEvidence?.resultUrl,
              urlscanScreenshotUrl: urlscanEvidence?.screenshotUrl,
            }),
          ),
        );
      });

      await step.run("assign-batch", async () => {
        const { data: updated, error } = await sb.rpc("assign_clone_alert_batch", {
          p_queue_ids: [enqueue.queue_id],
          p_batch_id: batchId,
          p_email_subject: subject,
          p_email_body_html: html,
          p_approval_url: "",
          // ALWAYS four-eyes — never auto, regardless of the routine
          // AUTO_SEND flag (plan doc open-question 1: four-eyes first).
          p_auto_approved: false,
        });
        if (error) throw new Error(`assign_clone_alert_batch: ${error.message}`);
        if ((updated as number | null) === 0) {
          // The row wasn't 'unbatched' — surfaces a staging race instead of
          // silently dropping the urgent alert.
          throw new Error(
            `assign_clone_alert_batch updated 0 rows for queue_id ${enqueue.queue_id}`,
          );
        }
      });

      await step.run("stamp-queued", async () => {
        await sb.rpc("merge_clone_alert_submission", {
          p_alert_id: alert.id,
          p_key: "weaponised_notification",
          p_value: {
            status: "staged_for_approval",
            batch_id: batchId,
            channel_type: directoryRow!.channel_type,
            via: data.via,
            queued_at: new Date().toISOString(),
          },
          p_set_triage_status: null,
        });
      });

      await step.run("telegram-admin", async () => {
        await sendAdminTelegramMessage(
          buildWeaponisedTelegramMessage({
            stage: "staged",
            brand: directoryRow!.brand,
            candidateDomain: alert.candidate_domain,
            via: data.via,
            urlscanResultUrl: urlscanEvidence?.resultUrl,
            channelType: directoryRow!.channel_type,
          }),
        );
      });

      await step.run("log-cost", async () => {
        logCost({
          feature: "shopfront_clone_notify_brand",
          provider: "queue",
          operation: "weaponised_enqueue",
          units: 0,
          unitCostUsd: 0,
          metadata: {
            alert_id: alert.id,
            brand: directoryRow!.brand,
            channel_type: directoryRow!.channel_type,
            via: data.via,
            batch_id: batchId,
            monitored_brand_id: monitoredBrand?.id ?? null,
            monitored_brand_plan: monitoredBrand?.plan ?? null,
          },
        });
      });

      // Rare high-value event — always-ship warn (bypasses INFO sampling).
      logger.warn("clone-watch: weaponised brand alert staged for approval", {
        alertId: alert.id,
        brand: directoryRow!.brand,
        candidateDomain: alert.candidate_domain,
        via: data.via,
        batchId,
        monitoredBrandPlan: monitoredBrand?.plan ?? null,
      });

      return { ok: true, staged: true, batchId, brand: directoryRow!.brand };
    },
  ),
);

// ── Pure helpers (exported for unit testing) ─────────────────────────────

/** Attribution jsonb tolerant reader — the enricher (v177+) writes
 *  {whois: {registrar, registrarAbuseEmail}, hosting: {ip, country, asn}};
 *  an older annotation used flat registrar/registrar_abuse_email keys.
 *  Accept both; absent enrichment (attribution NULL — the enricher only
 *  runs on confirmed alerts) yields no rows in the email. */
function readAttribution(raw: unknown): {
  registrar?: string;
  registrarAbuseEmail?: string;
  hostingIp?: string;
  hostingCountry?: string;
  hostingAsn?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const whois = (obj.whois ?? {}) as Record<string, unknown>;
  const hosting = (obj.hosting ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  return {
    registrar: str(whois.registrar) ?? str(obj.registrar),
    registrarAbuseEmail:
      str(whois.registrarAbuseEmail) ?? str(obj.registrar_abuse_email),
    hostingIp: str(hosting.ip),
    hostingCountry: str(hosting.country),
    hostingAsn: str(hosting.asn),
  };
}

export function buildWeaponisedAlertProps(
  alert: Pick<
    WeaponisedAlertRow,
    | "candidate_domain"
    | "candidate_url"
    | "inferred_target_domain"
    | "weaponised_at"
    | "netcraft_declined_at"
    | "attribution"
  >,
  opts: {
    brandName: string;
    reportRef: string;
    copy?: Record<string, string>;
    urlscanResultUrl?: string;
    urlscanScreenshotUrl?: string;
  },
): WeaponisedCloneAlertProps {
  const attribution = readAttribution(alert.attribution);
  return {
    brandName: opts.brandName,
    legitimateDomain: alert.inferred_target_domain ?? opts.brandName,
    candidateDomain: alert.candidate_domain,
    candidateUrl: alert.candidate_url,
    weaponisedAt: alert.weaponised_at ?? new Date().toISOString(),
    urlscanResultUrl: opts.urlscanResultUrl,
    urlscanScreenshotUrl: opts.urlscanScreenshotUrl,
    ...attribution,
    netcraftDeclinedAt: alert.netcraft_declined_at ?? undefined,
    reportRef: opts.reportRef,
    copy: opts.copy,
  };
}

export function buildWeaponisedSubject(
  brand: string,
  candidateDomain: string,
): string {
  return `Urgent: lookalike of ${brand} now serving suspected phishing — ${candidateDomain}`;
}

export function buildWeaponisedTelegramMessage(args: {
  stage: "staged" | "manual_channel" | "no_contact";
  brand: string;
  candidateDomain: string;
  via: string;
  urlscanResultUrl?: string;
  channelType?: string;
  recipient?: string;
  detail?: string;
}): string {
  const lines = [`🚨 <b>Clone-watch — lookalike WEAPONISED</b>`, ``];
  lines.push(
    `Brand: <b>${escapeHtml(args.brand)}</b>`,
    `Domain: <code>${escapeHtml(args.candidateDomain)}</code> (via ${escapeHtml(args.via)})`,
  );
  if (args.urlscanResultUrl) {
    lines.push(`Evidence: ${args.urlscanResultUrl}`);
  }
  switch (args.stage) {
    case "staged":
      lines.push(
        ``,
        `Brand alert staged for approval (${escapeHtml(args.channelType ?? "email")}).`,
        `Review and send: ${DASHBOARD_URL}`,
      );
      break;
    case "manual_channel":
      lines.push(
        ``,
        `No auto-email channel (<i>${escapeHtml(args.detail ?? "manual")}</i>) — notify the brand manually.`,
      );
      if (args.recipient) lines.push(`Open: ${escapeHtml(args.recipient)}`);
      break;
    case "no_contact":
      lines.push(
        ``,
        `⚠️ No brand contact on file (<i>${escapeHtml(args.detail ?? "no_directory_row")}</i>) — add a brand_contact_directory row to alert them.`,
      );
      break;
  }
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
