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
  | "held"
  | "taken_down"
  | "registered";

export const SQUAT_LABEL: Record<SquatView, string> = {
  phishing: "Live phishing",
  live: "Live site",
  parked: "Parked / for sale",
  held: "Suspended by registrar",
  taken_down: "Blocklisted",
  registered: "Registered, not serving",
};

/** What a brand should do first — lower sorts first. */
const PRIORITY: Record<SquatView, number> = {
  phishing: 0,
  live: 1,
  parked: 2,
  registered: 3,
  held: 4,
  taken_down: 5,
};

export function squatView(row: CloneDetectionRow): SquatView {
  if (row.lifecycleState === "weaponised") return "phishing";
  if (row.lifecycleState === "taken_down") return "taken_down";
  switch (row.squatStatus) {
    case "held":
      return "held";
    case "parked":
      return "parked";
    case "live":
      return "live";
  }
  // Pre-squat-status ledger rows: the urlscan classification is all we have.
  if (row.classification === "likely_phishing") return "phishing";
  if (row.classification === "parked_for_sale") return "parked";
  if (row.classification === "neutral") return "live";
  return "registered";
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
