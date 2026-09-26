/**
 * Month-over-month copy — THE one home for how Clone Watch words "more or
 * less than last month" (#1226), shared by the LinkedIn caption and the public
 * /clone-watch/[period] page, so the two can never tell the same month two
 * ways.
 *
 * HONESTY RULES (pinned by cloneWatchTrendCopy.test.ts):
 *  - A move within counting noise (|Δ| / √(this + last) < NOISE_Z) is "about
 *    the same" — never "up" or "down", however large the percentage looks.
 *  - A percentage only when both months clear TREND_FLOOR (card.mom.totalPct
 *    is already null otherwise); below it, the absolute change.
 *  - A matcher change between the months means no delta at all — the count
 *    moved because we changed what counts.
 *  - A feed-volume shift (>20% more or fewer domains swept) is always stated
 *    beside any delta: part of the change is feed size, not attackers.
 *  - The 3-month line prints only published (frozen) months; an unpublished
 *    month is skipped, never shown as 0.
 *
 * Imports only the pure gate (brand-coverage.ts), so older persisted
 * summaries — written before `mom.noise` existed — are judged by the same
 * rule from their numbers.
 */
import { NOISE_Z, moveSigma } from "@/lib/clone-watch/brand-coverage";

/** The fields of `MonthOverMonth` this Module reads (older rows lack the #1226 ones). */
export interface MomLike {
  available: boolean;
  priorLabel: string;
  priorTotal: number;
  totalDelta: number;
  totalPct: number | null;
  noise?: boolean;
  methodChanged?: boolean;
  feedShift?: { priorSwept: number; currentSwept: number; pct: number } | null;
  series?: Array<{ label: string; total: number | null }>;
}

export type TotalMove =
  | { kind: "not_comparable"; reason: "method_changed" | "no_prior" }
  | { kind: "same"; prior: number; current: number }
  | { kind: "up" | "down"; prior: number; current: number; delta: number; pct: number | null };

/** The ONE decision about the total's movement. */
export function totalMove(mom: MomLike): TotalMove {
  if (mom.methodChanged) return { kind: "not_comparable", reason: "method_changed" };
  if (!mom.available) return { kind: "not_comparable", reason: "no_prior" };
  const prior = mom.priorTotal;
  const current = prior + mom.totalDelta;
  const noise = mom.noise ?? moveSigma(current, prior) < NOISE_Z;
  if (noise || mom.totalDelta === 0) return { kind: "same", prior, current };
  return {
    kind: mom.totalDelta > 0 ? "up" : "down",
    prior,
    current,
    delta: mom.totalDelta,
    pct: mom.totalPct === 0 ? null : mom.totalPct,
  };
}

/** The feed-volume caveat, or "" when the feed was comparable / unknown. */
export function feedShiftSentence(mom: MomLike): string {
  const f = mom.feedShift;
  if (!f) return "";
  const dir = f.pct > 0 ? "larger" : "smaller";
  return `The domain feed we sweep was ${Math.abs(f.pct)}% ${dir} than in ${mom.priorLabel}, so part of any change is feed size, not attackers.`;
}

/** Caption sentence. `null` = no comparison to publish (the caller's baseline copy applies). */
export function describeTotalMove(mom: MomLike): string | null {
  const m = totalMove(mom);
  const feed = feedShiftSentence(mom);
  const tail = feed ? ` ${feed}` : "";
  switch (m.kind) {
    case "not_comparable":
      return m.reason === "method_changed"
        ? `We changed how lookalikes are matched since ${mom.priorLabel}, so this month is not comparable with it.`
        : null;
    case "same":
      return `That's about the same as ${mom.priorLabel} (${m.prior} → ${m.current}) — within normal month-to-month variation.${tail}`;
    default: {
      const size =
        m.pct !== null
          ? `${Math.abs(m.pct)}%`
          : `${Math.abs(m.delta)} domain${Math.abs(m.delta) === 1 ? "" : "s"}`;
      return `That's ${m.kind} ${size} on ${mom.priorLabel} (${m.prior} → ${m.current}).${tail}`;
    }
  }
}

/** Compact form for the public page header. `null` = show nothing. */
export function shortTotalMove(mom: MomLike): string | null {
  const m = totalMove(mom);
  if (m.kind === "not_comparable") return null;
  if (m.kind === "same") return `about the same as ${mom.priorLabel}`;
  const sign = m.delta > 0 ? "+" : "−";
  const pct = m.pct !== null ? ` (${sign}${Math.abs(m.pct)}%)` : "";
  return `${sign}${Math.abs(m.delta)}${pct} vs ${mom.priorLabel}`;
}

/** "Jun 2026 664 → Jul 2026 915 → Aug 2026 855" — published months only. */
export function threeMonthLine(mom: MomLike): string {
  // A matcher change makes the months different measurements.
  if (mom.methodChanged) return "";
  const pts = (mom.series ?? []).filter(
    (p): p is { label: string; total: number } => p.total !== null,
  );
  if (pts.length < 3) return "";
  return pts.map((p) => `${p.label} ${p.total}`).join(" → ");
}
