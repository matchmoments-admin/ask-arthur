/**
 * CVSS v3.x base-score arithmetic, and severity extraction from an OSV entry.
 *
 * WHY THIS EXISTS. `scanner.ts` used to decide "is this critical?" with
 *
 *     v.severity?.some((s) => parseFloat(s.score) >= 9.0)
 *
 * OSV's `severity[].score` is not a number. For `type: "CVSS_V3"` it is the
 * CVSS VECTOR STRING — verified against the live API on 2026-09-07, e.g.
 *
 *     { "type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H" }
 *
 * `parseFloat` of that is NaN, and `NaN >= 9.0` is false. Every comparison
 * failed, so `criticalVulns` was permanently empty and MCP-SC-001 could report
 * "warn" but never "fail", no matter how bad the dependency tree was — a
 * security control that always passed. It is the same
 * NaN-compares-false-against-everything mechanism that silently poisoned the
 * reddit-intel clusterer (fixed 2026-09-07); see docs/agents/defect-shapes.md.
 *
 * The formula below is the CVSS v3.1 specification (section 7.1). It is worth
 * the ~40 lines rather than reading GitHub's `database_specific.severity`
 * label, because that field is GitHub-specific and absent for advisories from
 * other OSV sources — though it is used as a fallback when no vector parses.
 */

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };
// Privileges Required is the one metric whose weight depends on Scope.
const PR_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

/** CVSS rounds UP to one decimal — not to-nearest. Spec's Appendix A. */
function roundUp1(x: number): number {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

/**
 * Compute the CVSS v3.x base score from a vector string.
 * Returns null when the string is not a parseable v3 vector — callers must
 * treat null as "unknown", never as zero.
 */
export function cvssV3BaseScore(vector: string): number | null {
  if (!vector.startsWith("CVSS:3.")) return null;
  const m = new Map<string, string>();
  for (const part of vector.split("/").slice(1)) {
    const [k, v] = part.split(":");
    if (k && v) m.set(k, v);
  }
  const scopeChanged = m.get("S") === "C";
  const av = AV[m.get("AV") ?? ""];
  const ac = AC[m.get("AC") ?? ""];
  const ui = UI[m.get("UI") ?? ""];
  const pr = (scopeChanged ? PR_CHANGED : PR_UNCHANGED)[m.get("PR") ?? ""];
  const c = CIA[m.get("C") ?? ""];
  const i = CIA[m.get("I") ?? ""];
  const a = CIA[m.get("A") ?? ""];
  if ([av, ac, ui, pr, c, i, a].some((n) => n === undefined)) return null;

  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp1(raw);
}

/** Labels used by GitHub advisories in OSV's `database_specific.severity`. */
const LABEL_FLOOR: Record<string, number> = {
  CRITICAL: 9.0,
  HIGH: 7.0,
  MODERATE: 4.0,
  MEDIUM: 4.0,
  LOW: 0.1,
};

export interface OsvLike {
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string } | null;
}

/**
 * Best available numeric severity for an OSV entry, or null if none can be
 * determined. Order: a numeric score, then a CVSS v3 vector, then a
 * source-specific label floor.
 */
export function osvSeverityScore(v: OsvLike): number | null {
  for (const s of v.severity ?? []) {
    const direct = Number(s.score);
    if (Number.isFinite(direct)) return direct;
    const computed = cvssV3BaseScore(s.score);
    if (computed !== null) return computed;
  }
  const label = v.database_specific?.severity?.toUpperCase();
  if (label && label in LABEL_FLOOR) return LABEL_FLOOR[label]!;
  return null;
}

/** CVSS v3 calls 9.0+ Critical. */
export const CRITICAL_FLOOR = 9.0;

export function isCriticalVuln(v: OsvLike): boolean {
  const score = osvSeverityScore(v);
  return score !== null && score >= CRITICAL_FLOOR;
}
