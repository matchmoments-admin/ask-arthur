import { html, joinHtml, type SafeHtml } from "@askarthur/utils/html";

/**
 * No-threat-on-phishing escalation (v329, #1234).
 *
 * A weaponised alert is one OUR urlscan saw serving phishing. When Netcraft
 * still grades it `no threats` / `unavailable` after its own escalation path
 * is spent — an explicit "Already reported and rejected.", or a report_issue
 * on the current submission that went unanswered for 72 h — re-filing to
 * Netcraft does nothing (v329 also stops the resubmit lane re-filing the
 * explicit rejections). The remaining levers (registrar abuse desk, Google
 * Safe Browsing report) are human-gated by design (ADR-0018), so the
 * escalation is to the operator.
 *
 * Measured 2026-09-26: 76 weaponised alerts meet that bar (49 rejected, 27
 * unanswered), with zero enforcement cases and zero onward reports between
 * them. The reconcile lane's `weaponisedNoThreats` (41 on its last run) counted
 * the same rows every run and triggered nothing.
 *
 * SQL decides (netcraft_vendor_gap_basis, via list_netcraft_vendor_gap) and
 * stamps once per alert (mark_netcraft_vendor_gap_escalated). This module
 * renders the page and owns the ORDER: list → page → mark. Every escalated row
 * is listed on /admin/clone-watch; the page names the top `maxListed`.
 */

/** Rows per run; the backlog of 76 drains in two runs. */
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
  /** What our DNS sweep last saw: present / inconclusive / null = never read. */
  dns_last?: string | null;
}

/** `[.]` so a Telegram client never renders the phishing site as a link. */
export function defang(domain: string): string {
  return domain.replace(/\./g, "[.]");
}

/** What our DNS actually saw — never implied. */
export function dnsLastLabel(v: string | null | undefined): string {
  if (v === "present") return "DNS: resolves";
  if (v === "inconclusive") return "DNS: inconclusive";
  if (v === "gone") return "DNS: NXDOMAIN (unconfirmed)";
  return "DNS: not yet read";
}

export function buildVendorGapPage(
  rows: readonly VendorGapRow[],
  maxListed: number = VENDOR_GAP_ESCALATION.maxListed,
): SafeHtml | null {
  if (rows.length === 0) return null;
  const rejected = rows.filter((r) => r.basis === "rejected").length;
  const resolving = rows.filter((r) => r.dns_last === "present").length;
  const listed = rows.slice(0, maxListed);
  const more = rows.length - listed.length;
  return joinHtml(
    [
      // One template per line: the literal text IS the message (Telegram
      // renders every newline), so these must never be reflowed.
      // prettier-ignore
      html`🚩 <b>Clone-watch — Netcraft won't act on ${rows.length} site${rows.length === 1 ? "" : "s"} we saw phishing</b>`,
      // prettier-ignore
      html`Our urlscan saw each one serving phishing; Netcraft grades it clean after its own escalation path ran out (${rejected} "Already reported and rejected.", ${rows.length - rejected} with our issue unanswered 72h+). Our last DNS read: ${resolving} resolve, ${rows.length - resolving} inconclusive or not yet read.`,
      ...listed.map(
        // prettier-ignore
        (r) => html`• <code>${defang(r.candidate_domain)}</code> — ${r.brand ?? "unknown brand"} · Netcraft: ${r.url_state} · ${dnsLastLabel(r.dns_last)}`,
      ),
      ...(more > 0 ? [html`…and ${more} more — all listed on /admin/clone-watch.`] : []),
      // prettier-ignore
      html`Next levers are human-gated: registrar abuse desk, Google Safe Browsing report. Rows carry <code>submitted_to.vendor_gap</code>.`,
    ],
    "\n",
  );
}

export interface VendorGapDeps {
  list: () => Promise<{ rows: VendorGapRow[] } | { error: string }>;
  send: (
    message: SafeHtml,
  ) => Promise<{ ok: boolean; reason?: string; error?: string }>;
  mark: (ids: number[]) => Promise<{ marked: number } | { error: string }>;
  /** One audit event per escalated alert. */
  audit: (row: VendorGapRow) => void;
}

export interface VendorGapOutcome {
  /** Alerts stamped this run; null = the list or the mark failed. */
  escalated: number | null;
  paged: boolean;
  /** Rows listed but not paged (send failed or no Telegram config). */
  unpaged?: number;
  error?: string;
}

/**
 * list → page → mark. NEVER throws (review #1254): a thrown page failure used
 * to fail the whole reconcile run and lose its Outcome Row. A failed send
 * stamps nothing, so the same rows re-list next run — at-least-once, with the
 * failure in the Outcome Row instead of an exception.
 */
export async function escalateVendorGap(deps: VendorGapDeps): Promise<VendorGapOutcome> {
  const listed = await deps.list();
  if ("error" in listed) return { escalated: null, paged: false, error: `list: ${listed.error}` };
  const rows = listed.rows;
  const message = buildVendorGapPage(rows);
  if (!message) return { escalated: 0, paged: false };
  const sent = await deps.send(message);
  if (!sent.ok) {
    return {
      escalated: 0,
      paged: false,
      unpaged: rows.length,
      error: `page: ${sent.error ?? sent.reason ?? "send failed"}`,
    };
  }
  const mark = await deps.mark(rows.map((r) => r.id));
  // Paged but not stamped: the next run re-pages the same rows — louder than
  // silence — and the error travels in the Outcome Row.
  if ("error" in mark) return { escalated: null, paged: true, error: `mark: ${mark.error}` };
  for (const r of rows) deps.audit(r);
  return { escalated: mark.marked, paged: true };
}
