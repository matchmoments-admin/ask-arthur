import { html, joinHtml, type SafeHtml } from "@askarthur/utils/html";

/**
 * No-threat-on-phishing escalation (v329, #1234).
 *
 * A weaponised alert is one OUR urlscan saw serving phishing. When Netcraft
 * still grades it `no threats` / `unavailable` after its own escalation path
 * is spent — an explicit "Already reported and rejected.", or a report_issue
 * on the current submission that went unanswered for 72 h — re-filing to
 * Netcraft does nothing (the v250 resubmit lane gets the same rejection). The
 * remaining levers (registrar abuse desk, Google Safe Browsing report) are
 * human-gated by design (ADR-0018), so the escalation is to the operator.
 *
 * Measured 2026-09-26: 76 weaponised alerts meet that bar (49 rejected, 27
 * unanswered), with zero enforcement cases and zero onward reports between
 * them. The reconcile lane's `weaponisedNoThreats` (41 on its last run) counted
 * the same rows every run and triggered nothing.
 *
 * escalate_netcraft_vendor_gap (v329) decides and stamps (once per alert);
 * this module only renders the page.
 */

/** Rows per run the RPC may stamp; the backlog of 76 drains in two runs. */
export const VENDOR_GAP_ESCALATION = {
  minIssueAgeHours: 72,
  limit: 50,
  /** Domains listed by name in one page; the rest are counted. */
  maxListed: 10,
} as const;

export interface VendorGapRow {
  id: number;
  candidate_domain: string;
  brand: string | null;
  url_state: string;
  basis: "rejected" | "issue_unanswered" | string;
}

/** `[.]` so a Telegram client never renders the phishing site as a link. */
export function defang(domain: string): string {
  return domain.replace(/\./g, "[.]");
}

export function buildVendorGapPage(
  rows: readonly VendorGapRow[],
  maxListed: number = VENDOR_GAP_ESCALATION.maxListed,
): SafeHtml | null {
  if (rows.length === 0) return null;
  const rejected = rows.filter((r) => r.basis === "rejected").length;
  const listed = rows.slice(0, maxListed);
  const more = rows.length - listed.length;
  return joinHtml(
    [
      // One template per line: the literal text IS the message (Telegram
      // renders every newline), so these must never be reflowed.
      // prettier-ignore
      html`🚩 <b>Clone-watch — Netcraft won't act on ${rows.length} site${rows.length === 1 ? "" : "s"} we saw phishing</b>`,
      // prettier-ignore
      html`Our urlscan saw each one serving phishing and our last DNS read did not find it gone; Netcraft grades it clean after its own escalation path ran out (${rejected} "Already reported and rejected.", ${rows.length - rejected} with our issue unanswered 72h+).`,
      ...listed.map(
        // prettier-ignore
        (r) => html`• <code>${defang(r.candidate_domain)}</code> — ${r.brand ?? "unknown brand"} · Netcraft: ${r.url_state}`,
      ),
      ...(more > 0 ? [html`…and ${more} more.`] : []),
      // prettier-ignore
      html`Next levers are human-gated: registrar abuse desk, Google Safe Browsing report. Rows carry <code>submitted_to.vendor_gap</code>.`,
    ],
    "\n",
  );
}
