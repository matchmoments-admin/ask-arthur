/**
 * One answer to "does this domain get a badge, and what does it say".
 *
 * WHY THIS EXISTS — and it is a correction to my own change.
 *
 * `/api/badge` used to render whatever the query string asked for. Fixing that
 * meant giving it a `sites` lookup, and I wrote one — beside the lookup that
 * `app/badge/[domain]/route.ts` already had. Two routes then made the same
 * trust decision independently, and they immediately disagreed:
 *
 *     /api/badge        ["A+", "A", "A-", "B+", "B", "B-"]
 *     /badge/[domain]   ["A+", "A", "B"]
 *
 * So a site graded B+ would have earned a badge from one route and "Needs
 * improvement" from the other. In the change whose entire point was that the
 * badge must tell the truth, I shipped two versions of what the truth is.
 *
 * DELETION TEST: delete this module and the lookup, the eligibility rule, the
 * grade colours and the neutral-badge wording all reappear in both routes,
 * free to drift apart again. It concentrates. Two adapters, so the seam is
 * real rather than hypothetical.
 */
import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";

/**
 * Grades that earn a scored badge: B- or better.
 *
 * This RESOLVES a disagreement rather than picking a side. `/badge/[domain]`
 * had `["A+", "A", "B"]`, which excludes A- and B+ while admitting B — a site
 * could be graded better than one that qualifies and be refused. That reads as
 * an oversight from before `SecurityGrade` gained modifiers, not a decision.
 *
 * `SecurityGrade` (packages/types/src/scanner.ts:5) spans A+ down to F, so the
 * modifiers are representable. None occurs in `sites` today — every row is A,
 * B, C, D or F — so this is inert on current data and closes a latent
 * inconsistency before it can surface.
 */
export const BADGE_ELIGIBLE_GRADES: ReadonlySet<string> = new Set([
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
]);

/** One colour table. The routes had two, with different coverage. */
export const BADGE_GRADE_COLORS: Record<string, string> = {
  "A+": "#388E3C",
  A: "#388E3C",
  "A-": "#4CAF50",
  "B+": "#006B75",
  B: "#006B75",
  "B-": "#008A98",
  "C+": "#F57C00",
  C: "#F57C00",
  "C-": "#E65100",
  D: "#D84315",
  F: "#D32F2F",
};

export function badgeGradeColor(grade: string): string {
  return BADGE_GRADE_COLORS[grade] ?? BADGE_GRADE_COLORS.F;
}

export type BadgeSubject =
  | { kind: "ok"; grade: string; score: number; scannedAt: string }
  /** Not in `sites`, or scanned but ungraded. */
  | { kind: "unscanned" }
  /** Graded, but below the bar — we say so rather than saying nothing. */
  | { kind: "ineligible" }
  /** We could not check. Distinct from "we checked and found nothing". */
  | { kind: "unavailable" };

/** Wording, in one place, so the two routes cannot describe the same state
 *  differently. */
export const BADGE_MESSAGES: Record<
  Exclude<BadgeSubject["kind"], "ok">,
  string
> = {
  unscanned: "Not yet scanned",
  ineligible: "Needs improvement",
  unavailable: "Unavailable",
};

/**
 * Resolve what we can honestly say about a domain.
 *
 * Fails CLOSED on every uncertain path. A badge is a claim; if we cannot
 * check it we do not make it, and a transient outage must not reintroduce the
 * forgery this was written to close.
 */
export async function resolveBadgeSubject(
  rawDomain: string | null | undefined,
): Promise<BadgeSubject> {
  const domain = (rawDomain ?? "").trim().toLowerCase();
  // No subject means no claim. The old route defaulted to A+ here, which is
  // exactly backwards.
  if (!domain) return { kind: "unscanned" };

  const supabase = createServiceClient();
  if (!supabase) return { kind: "unavailable" };

  const { data, error } = await supabase
    .from("sites")
    .select("latest_grade, latest_score, last_scanned_at")
    .eq("domain", domain)
    .single();

  if (error || !data?.latest_grade || data.latest_score == null) {
    return { kind: "unscanned" };
  }
  if (!BADGE_ELIGIBLE_GRADES.has(data.latest_grade)) {
    return { kind: "ineligible" };
  }
  return {
    kind: "ok",
    grade: data.latest_grade,
    score: data.latest_score,
    scannedAt: (data.last_scanned_at ?? new Date().toISOString()).slice(0, 10),
  };
}
