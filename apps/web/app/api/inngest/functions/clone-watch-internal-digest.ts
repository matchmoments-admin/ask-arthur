import { Resend } from "resend";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import {
  aggregateClonesByDomain,
  priorMonthStart,
  type CloneAlertRow,
  type CloneBrandMetrics,
} from "@/app/api/inngest/functions/report-brand-stewardship";

/**
 * Clone-Watch internal all-clones digest.
 *
 * The brand-stewardship report only emails brands that have a contact. This
 * sends ONE internal digest to BRAND_STEWARDSHIP_SHADOW_RECIPIENT covering
 * EVERY detected brand for the period — including the ones we can't notify
 * (no contact) — so the operator has full situational awareness of what's
 * being impersonated and where it's hosted, regardless of deliverability.
 *
 * Internal-only (goes to us), so it renders a plain HTML table rather than a
 * branded React-Email template. Monthly, mirroring the brand report.
 */

const CLONE_FETCH_LIMIT = 5000;
const TOP_CLONES_PER_BRAND = 5;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function hosting(d: CloneBrandMetrics["domains"][number]): string {
  const parts = [d.ip, d.asn, d.country].filter(Boolean);
  return parts.length ? esc(parts.join(" · ")) : "—";
}

/** Build the internal digest HTML. Pure + unit-tested. */
export function buildInternalDigestHtml(
  periodLabel: string,
  byBrand: Map<string, CloneBrandMetrics>,
): string {
  const brands = [...byBrand.entries()].sort(
    (a, b) => b[1].detected - a[1].detected,
  );
  const totalClones = brands.reduce((n, [, m]) => n + m.detected, 0);
  const totalPhishing = brands.reduce(
    (n, [, m]) => n + (m.byClassification.likely_phishing ?? 0),
    0,
  );

  const sections = brands
    .map(([domain, m]) => {
      const rows = m.domains
        .slice(0, TOP_CLONES_PER_BRAND)
        .map(
          (d) =>
            `<tr><td style="padding:3px 8px;font-family:monospace;font-size:12px">${esc(d.domain)}</td>` +
            `<td style="padding:3px 8px;font-size:12px">${esc(d.classification ?? "—")}</td>` +
            `<td style="padding:3px 8px;font-size:12px;color:#475569">${hosting(d)}</td>` +
            `<td style="padding:3px 8px;font-size:12px;color:#475569">${esc(d.registrar ?? "—")}</td></tr>`,
        )
        .join("");
      const more =
        m.detected > TOP_CLONES_PER_BRAND
          ? `<tr><td colspan="4" style="padding:2px 8px;font-size:11px;color:#94a3b8">+ ${m.detected - TOP_CLONES_PER_BRAND} more</td></tr>`
          : "";
      const phishing = m.byClassification.likely_phishing ?? 0;
      return (
        `<h3 style="margin:18px 0 4px;font-size:14px;color:#1B2A4A">${esc(domain)} — ${m.detected} clone${m.detected === 1 ? "" : "s"}` +
        (phishing ? ` <span style="color:#DC2626">(${phishing} likely phishing)</span>` : "") +
        `</h3><table style="border-collapse:collapse;width:100%"><tbody>${rows}${more}</tbody></table>`
      );
    })
    .join("");

  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;color:#334155">` +
    `<h2 style="color:#1B2A4A">Clone-Watch internal digest — ${esc(periodLabel)}</h2>` +
    `<p style="font-size:14px"><b>${totalClones}</b> lookalike domains detected across <b>${brands.length}</b> brands` +
    (totalPhishing ? ` · <b style="color:#DC2626">${totalPhishing}</b> likely phishing` : "") +
    `. This is the full internal picture — including brands with no security contact (not emailed).</p>` +
    sections +
    `<p style="font-size:11px;color:#94a3b8;margin-top:24px">Ask Arthur internal — clone-watch detections only, not a determination of malice.</p></div>`
  );
}

export const cloneWatchInternalDigest = inngest.createFunction(
  {
    id: "clone-watch-internal-digest",
    name: "Clone-Watch: internal all-clones digest",
    timeouts: { finish: "4m" },
    retries: 1,
  },
  [
    { cron: "0 10 1 * *" }, // 1st of month, 10:00 UTC (after the brand report)
    { event: "clone-watch/internal-digest.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "clone-watch-internal-digest" }, async ({ event, step }) => {
    if (!featureFlags.brandStewardshipReport) {
      return { skipped: true, reason: "FF_BRAND_STEWARDSHIP_REPORT disabled" };
    }
    const recipient = readStringEnv("BRAND_STEWARDSHIP_SHADOW_RECIPIENT");
    if (!recipient) {
      return { skipped: true, reason: "no BRAND_STEWARDSHIP_SHADOW_RECIPIENT" };
    }
    const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
    const apiKey = process.env.RESEND_API_KEY;
    if (!fromEmail || !apiKey) {
      return { skipped: true, reason: "email_not_configured" };
    }

    const periodOverride = (
      event?.data as { periodMonth?: string } | undefined
    )?.periodMonth;

    const period = await step.run("compute-period", async () => {
      const start = periodOverride
        ? new Date(`${periodOverride}T00:00:00Z`)
        : priorMonthStart(new Date());
      const end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      );
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    });
    const periodMonth = period.startIso.slice(0, 10);
    const label = new Date(period.startIso).toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    const cloneRows = await step.run("fetch-clones", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CloneAlertRow[];
      const { data } = await sb
        .from("shopfront_clone_alerts")
        .select(
          "id, candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution",
        )
        .eq("source", "nrd")
        .gte("first_seen_at", period.startIso)
        .lt("first_seen_at", period.endIso)
        .not("inferred_target_domain", "is", null)
        .limit(CLONE_FETCH_LIMIT);
      return (data ?? []) as unknown as CloneAlertRow[];
    });

    const byBrand = aggregateClonesByDomain(cloneRows);
    if (byBrand.size === 0) {
      return { ok: true, period: periodMonth, brands: 0, reason: "no_clones" };
    }

    const html = buildInternalDigestHtml(label, byBrand);

    const sent = await step.run("send-digest", async () => {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send(
        {
          from: fromEmail,
          to: [recipient],
          subject: `Clone-Watch internal digest — ${label}`,
          html,
        },
        { idempotencyKey: `cw-internal-digest:${periodMonth}` },
      );
      if (result.error) {
        throw new Error(result.error.message ?? String(result.error));
      }
      return result.data?.id ?? null;
    });

    logCost({
      feature: "brand_stewardship",
      provider: "resend",
      operation: "internal_digest",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    });

    logger.info("clone-watch-internal-digest: sent", {
      period: periodMonth,
      brands: byBrand.size,
      messageId: sent,
    });
    return { ok: true, period: periodMonth, brands: byBrand.size, messageId: sent };
  }),
);
