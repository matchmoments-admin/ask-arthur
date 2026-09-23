/**
 * "Who is squatting your brand" — the brand-facing view of a period's
 * lookalike domains: what each one IS right now, who registered it, when, and
 * where to report it. Pure; used by /clone-report/[token].
 *
 * One status per domain, combining the two independent facts we hold:
 *   - the Clone Lifecycle (weaponised / taken_down — our urlscan + Netcraft view)
 *   - the infrastructure squat status (held / parked / live — RDAP + nameservers,
 *     clone-metrics squatStatus)
 * The lifecycle wins where it says something stronger (live phishing, taken
 * down). Ledger rows written before the squat status existed fall back to the
 * urlscan classification, so older reports still render honestly.
 */
import type { CloneDetectionRow } from "@/emails/BrandStewardshipReport";

export type SquatView =
  | "phishing"
  | "live"
  | "parked"
  | "held_phishing"
  | "held"
  | "taken_down"
  | "registered"
  | "unverified";

export const SQUAT_LABEL: Record<SquatView, string> = {
  phishing: "Live phishing",
  live: "Live site",
  parked: "Parked / for sale",
  held_phishing: "Suspended (was phishing)",
  held: "Suspended by registrar",
  taken_down: "Blocklisted",
  registered: "Registered, not serving",
  unverified: "Not yet verified",
};

/** One-line definition per status — the page legend renders ALL of them, so
 *  no label reaches a brand undefined (review 2026-09-23). */
export const SQUAT_DEFINITION: Record<SquatView, string> = {
  phishing:
    "our scan observed credential- or payment-harvesting content on it",
  live: "our scan reached a server hosting a site on it",
  parked: "it sits on a domain-parking or aftermarket (for-sale) nameserver",
  held_phishing:
    "we observed phishing on it, and the registrar has since suspended it (client/server hold)",
  held: "the registrar or registry has suspended it (client/server hold)",
  taken_down:
    "Netcraft classified it malicious, so browser blocklists warn on it — the site may still be online",
  registered: "registered, but our scan found nothing serving on it",
  unverified: "registered recently and not yet scanned",
};

/** What a brand should do first — lower sorts first. */
const PRIORITY: Record<SquatView, number> = {
  phishing: 0,
  live: 1,
  parked: 2,
  unverified: 3,
  registered: 4,
  held_phishing: 5,
  held: 6,
  taken_down: 7,
};

export function squatView(row: CloneDetectionRow): SquatView {
  // A registry/registrar hold is the strongest fact about the domain TODAY: a
  // suspended name is not a live threat, whatever it did before.
  if (row.squatStatus === "held") {
    return row.lifecycleState === "weaponised" ? "held_phishing" : "held";
  }
  if (row.lifecycleState === "weaponised") return "phishing";
  if (row.lifecycleState === "taken_down") return "taken_down";
  if (row.squatStatus === "parked") return "parked";
  if (row.squatStatus === "live") return "live";
  if (row.squatStatus === "unknown") {
    // Known unknown: no server, no parking NS, no hold. Only a completed scan
    // that found nothing earns "not serving"; otherwise it is unverified.
    return row.classification ? "registered" : "unverified";
  }
  // Squat status ABSENT (ledger rows written before 2026-09-22): the urlscan
  // classification is all we have. Never applied to a known "unknown" — that
  // fallback read "neutral" as a live site for 21 of Apple's 43 (review).
  if (row.classification === "likely_phishing") return "phishing";
  if (row.classification === "parked_for_sale") return "parked";
  if (row.classification === "neutral") return "live";
  return row.classification ? "registered" : "unverified";
}

export interface SquattingRow extends CloneDetectionRow {
  view: SquatView;
}

/** Most urgent first; within a status, newest registration first. */
export function squattingRows(rows: CloneDetectionRow[]): SquattingRow[] {
  return rows
    .map((r) => ({ ...r, view: squatView(r) }))
    .sort((a, b) => {
      const p = PRIORITY[a.view] - PRIORITY[b.view];
      if (p !== 0) return p;
      const da = a.registeredAt ?? a.firstSeenAt ?? "";
      const db = b.registeredAt ?? b.firstSeenAt ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return a.domain.localeCompare(b.domain);
    });
}

/** Counts per status, in priority order, zeros omitted. */
export function squattingSummary(
  rows: SquattingRow[],
): Array<{ view: SquatView; label: string; count: number }> {
  const counts = new Map<SquatView, number>();
  for (const r of rows) counts.set(r.view, (counts.get(r.view) ?? 0) + 1);
  return (Object.keys(PRIORITY) as SquatView[])
    .sort((a, b) => PRIORITY[a] - PRIORITY[b])
    .filter((v) => (counts.get(v) ?? 0) > 0)
    .map((v) => ({ view: v, label: SQUAT_LABEL[v], count: counts.get(v)! }));
}

/** "2026-09-19" → "19 Sep 2026"; null when absent or unparsable. */
export function formatRegistered(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A registrar abuse address safe to put in a mailto: href — WHOIS/RDAP data is
 *  third-party input, so anything that isn't a plain address is dropped
 *  (a `?cc=` or `&body=` would otherwise rewrite the brand's email). */
export function safeAbuseEmail(email: string | null | undefined): string | null {
  const e = email?.trim() ?? "";
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(e) ? e : null;
}
