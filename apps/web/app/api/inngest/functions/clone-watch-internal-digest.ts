import { Resend } from "resend";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import {
  aggregateClonesByDomain,
  priorMonthStart,
  type CloneAlertRow,
  type CloneBrandMetrics,
} from "@/app/api/inngest/functions/report-brand-stewardship";

/** Local extended row — the shared CloneAlertRow doesn't carry the full URL
 *  (only candidate_domain); we select candidate_url locally for the full-mode
 *  per-brand URL list, without touching the shared type/aggregator. */
type CloneRowWithUrl = CloneAlertRow & { candidate_url: string | null };

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

/** Aggregate every brand's per-registrar clone counts (uncapped — byRegistrar
 *  is summed before the per-brand 100-cap) into one global rollup, plus a
 *  best-effort registrar→abuse-email map from the (capped) detail rows. The
 *  null/empty-registrar bucket is keyed "Unknown" by the shared aggregator. */
export function buildRegistrarRollup(byBrand: Map<string, CloneBrandMetrics>): {
  rows: Array<{ registrar: string; clones: number; abuseEmail: string | null }>;
  unknownCount: number;
} {
  const counts = new Map<string, number>();
  const abuse = new Map<string, string>();
  for (const [, m] of byBrand) {
    for (const [reg, n] of Object.entries(m.byRegistrar)) {
      counts.set(reg, (counts.get(reg) ?? 0) + n);
    }
    for (const d of m.domains) {
      if (d.registrar && d.abuse_email && !abuse.has(d.registrar)) {
        abuse.set(d.registrar, d.abuse_email);
      }
    }
  }
  const unknownCount = counts.get("Unknown") ?? 0;
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([registrar, clones]) => ({
      registrar,
      clones,
      abuseEmail: abuse.get(registrar) ?? null,
    }));
  return { rows, unknownCount };
}

/** Build the internal digest HTML. Pure + unit-tested.
 *
 *  Default (flag OFF): the original top-5-per-brand capped table — unchanged.
 *  `opts.full` (FF_ADMIN_CLONE_SUMMARY_DIGEST ON): a Scamwatch-submission aid —
 *  EVERY clone URL per brand (from `opts.urlsByBrand`, uncapped) + a global
 *  "registrars that provided them" rollup with abuse emails. */
export function buildInternalDigestHtml(
  periodLabel: string,
  byBrand: Map<string, CloneBrandMetrics>,
  opts?: { urlsByBrand?: Map<string, string[]>; full?: boolean },
): string {
  const full = opts?.full ?? false;
  const urlsByBrand = opts?.urlsByBrand;
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
      const phishing = m.byClassification.likely_phishing ?? 0;
      const heading =
        `<h3 style="margin:18px 0 4px;font-size:14px;color:#1B2A4A">${esc(domain)} — ${m.detected} clone${m.detected === 1 ? "" : "s"}` +
        (phishing ? ` <span style="color:#DC2626">(${phishing} likely phishing)</span>` : "") +
        `</h3>`;

      if (full) {
        // Every clone URL for this brand (uncapped) — the per-registrar detail
        // lives in the rollup below, so the per-brand list stays URL-focused.
        const urls = urlsByBrand?.get(domain) ?? m.domains.map((d) => d.domain);
        const list = urls
          .map(
            (u) =>
              `<div style="padding:1px 0;font-family:monospace;font-size:12px;color:#334155">${esc(u)}</div>`,
          )
          .join("");
        return `${heading}<div style="margin:0 0 4px 0">${list}</div>`;
      }

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
      return `${heading}<table style="border-collapse:collapse;width:100%"><tbody>${rows}${more}</tbody></table>`;
    })
    .join("");

  // "Registrars that provided them" rollup — full mode only.
  let rollup = "";
  if (full) {
    const { rows, unknownCount } = buildRegistrarRollup(byBrand);
    const trs = rows
      .map(
        (r) =>
          `<tr><td style="padding:3px 8px;font-size:12px">${esc(r.registrar)}</td>` +
          `<td style="padding:3px 8px;font-size:12px;text-align:right">${r.clones}</td>` +
          `<td style="padding:3px 8px;font-family:monospace;font-size:12px;color:#475569">${esc(r.abuseEmail ?? "—")}</td></tr>`,
      )
      .join("");
    rollup =
      `<h2 style="color:#1B2A4A;margin-top:28px;font-size:16px">Registrars that provided these clones</h2>` +
      `<table style="border-collapse:collapse;width:100%"><thead><tr>` +
      `<th style="padding:3px 8px;text-align:left;font-size:12px;color:#64748b">Registrar</th>` +
      `<th style="padding:3px 8px;text-align:right;font-size:12px;color:#64748b">Clones</th>` +
      `<th style="padding:3px 8px;text-align:left;font-size:12px;color:#64748b">Abuse email</th>` +
      `</tr></thead><tbody>${trs}</tbody></table>` +
      (unknownCount > 0
        ? `<p style="font-size:11px;color:#94a3b8;margin:4px 0 0">Registrar unknown for ${unknownCount} domain${unknownCount === 1 ? "" : "s"} (WHOIS attribution is best-effort / sparsely populated).</p>`
        : "") +
      `<p style="font-size:12px;color:#475569;margin-top:8px">Submit the full per-brand list above via the Scamwatch web form (report.scamwatch.gov.au); use the registrar abuse emails for direct takedown notices.</p>`;
  }

  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;color:#334155">` +
    `<h2 style="color:#1B2A4A">Clone-Watch internal digest — ${esc(periodLabel)}</h2>` +
    `<p style="font-size:14px"><b>${totalClones}</b> lookalike domains detected across <b>${brands.length}</b> brands` +
    (totalPhishing ? ` · <b style="color:#DC2626">${totalPhishing}</b> likely phishing` : "") +
    `. This is the full internal picture — including brands with no security contact (not emailed).</p>` +
    sections +
    rollup +
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

    // Full mode = the Scamwatch-submission aid (FF_ADMIN_CLONE_SUMMARY_DIGEST).
    // OFF → the digest is byte-identical to today.
    const full = featureFlags.adminCloneSummaryDigest;

    const cloneRows = await step.run("fetch-clones", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CloneRowWithUrl[];
      let q = sb
        .from("shopfront_clone_alerts")
        .select(
          "id, candidate_domain, candidate_url, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution, triage_status",
        )
        .eq("source", "nrd")
        .gte("first_seen_at", period.startIso)
        .lt("first_seen_at", period.endIso)
        .not("inferred_target_domain", "is", null);
      // Full mode mirrors the brand report's FP/triage exclusion (the legacy
      // digest lacked it); OFF path keeps today's rows so it stays identical.
      if (full) q = q.or("triage_status.is.null,triage_status.neq.fp");
      const { data } = await q.limit(CLONE_FETCH_LIMIT);
      if ((data?.length ?? 0) === CLONE_FETCH_LIMIT) {
        logger.warn("clone-watch-internal-digest: clone fetch hit LIMIT", {
          limit: CLONE_FETCH_LIMIT,
          period: periodMonth,
        });
      }
      let rows = (data ?? []) as unknown as CloneRowWithUrl[];
      if (full) rows = rows.filter((r) => !isFpBrand(r.inferred_target_domain));
      return rows;
    });

    const byBrand = aggregateClonesByDomain(cloneRows);
    if (byBrand.size === 0) {
      return { ok: true, period: periodMonth, brands: 0, reason: "no_clones" };
    }

    // Full mode only: a LOCAL uncapped map of every clone URL per brand (the
    // shared aggregator caps detail at 100/brand and carries only the domain).
    const urlsByBrand = new Map<string, string[]>();
    if (full) {
      for (const r of cloneRows) {
        const brand = r.inferred_target_domain;
        if (!brand) continue;
        const url = r.candidate_url || r.candidate_domain;
        if (!url) continue;
        const arr = urlsByBrand.get(brand) ?? [];
        if (!arr.includes(url)) arr.push(url);
        urlsByBrand.set(brand, arr);
      }
    }

    const html = buildInternalDigestHtml(
      label,
      byBrand,
      full ? { urlsByBrand, full: true } : undefined,
    );

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

    // Full mode only: a bounded Telegram summary (the full per-brand+URL list is
    // in the email — sendAdminTelegramMessage has no chunker + a 4096-char cap,
    // so a full dump would silently 400). Own step → replay-safe (retries:1).
    if (full) {
      await step.run("admin-clone-telegram", async () => {
        const { rows, unknownCount } = buildRegistrarRollup(byBrand);
        const totalClones = [...byBrand.values()].reduce(
          (n, m) => n + m.detected,
          0,
        );
        const topReg = rows
          .slice(0, 8)
          .map((r) => `• ${esc(r.registrar)} — ${r.clones}`)
          .join("\n");
        await sendAdminTelegramMessage(
          [
            `<b>Clone-watch summary — ${esc(label)}</b>`,
            `${totalClones} clone URLs across ${byBrand.size} brands.`,
            `Top registrars (by clones provided):`,
            topReg,
            unknownCount > 0 ? `(registrar unknown for ${unknownCount})` : "",
            `Full per-brand URL list + abuse emails emailed. Submit via the Scamwatch web form (report.scamwatch.gov.au).`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        logCost({
          feature: "brand_stewardship",
          provider: "telegram",
          operation: "admin_clone_summary",
          units: 1,
          unitCostUsd: 0,
        });
      });
    }

    logger.info("clone-watch-internal-digest: sent", {
      period: periodMonth,
      brands: byBrand.size,
      messageId: sent,
    });
    return { ok: true, period: periodMonth, brands: byBrand.size, messageId: sent };
  }),
);
