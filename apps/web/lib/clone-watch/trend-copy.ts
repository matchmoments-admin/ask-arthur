/**
 * Month-over-month copy — THE one home for how Clone Watch words "more or
 * less than last month" (#1226), shared by the LinkedIn caption, the carousel
 * (the biggest-mover slide) and the public /clone-watch/[period] page, so they
 * can never tell the same month two ways. That includes the matcher-change
 * disclosure: it lives here only (methodChangeSentence).
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

/**
 * THE matcher-change disclosure — the one sentence that says the month cannot
 * be compared with the last because WE changed what counts. `null` when the
 * matcher did not change. Used by the caption (through describeTotalMove) and
 * the /clone-watch/[period] edition page, which previously said nothing at all
 * in that month; targeting-copy's buildTrendDisclosure used to carry a second
 * wording of the same fact, so the caption stated it twice.
 */
export function methodChangeSentence(mom: MomLike): string | null {
  return mom.methodChanged
    ? `We changed how lookalikes are matched since ${mom.priorLabel}, so this month is not comparable with it.`
    : null;
}

/** The per-brand exclusion reason for the same fact (the trend disclosure's list). */
export function methodChangedBrandsClause(count: number): string {
  return `${count} where we changed how lookalikes are matched between the months`;
}

/** Caption sentence. `null` = no comparison to publish (the caller's baseline copy applies). */
export function describeTotalMove(mom: MomLike): string | null {
  const m = totalMove(mom);
  const feed = feedShiftSentence(mom);
  const tail = feed ? ` ${feed}` : "";
  switch (m.kind) {
    case "not_comparable":
      return m.reason === "method_changed" ? methodChangeSentence(mom) : null;
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

/**
 * THE wording of the month's biggest mover (spotlight.ts `kind: "mover"`),
 * shared by the LinkedIn caption and the carousel's spotlight slide.
 *
 * Two copies had drifted: the caption said "more than double" at exactly 2×,
 * and the slide printed "more than {doubled|jumped}" — "more than jumped" for
 * any rise short of doubling. The verb is decided once, here:
 *   > 2× → "more than doubled", = 2× → "doubled", otherwise "jumped".
 * The mover rung is AU brands (plus watchlisted super funds) that cleared the
 * coverage gate, so "the sharpest rise" is scoped to exactly that set.
 */
export interface MoverCopy {
  verb: "more than doubled" | "doubled" | "jumped";
  /** Caption finding. */
  sentence: string;
  /** Slide lead, after the "{name} lookalikes {verb}." heading. */
  lead: string;
}

export function moverCopy(name: string, m: { priorClones: number; clones: number }): MoverCopy {
  const verb: MoverCopy["verb"] =
    m.priorClones > 0 && m.clones > m.priorClones * 2
      ? "more than doubled"
      : m.priorClones > 0 && m.clones === m.priorClones * 2
        ? "doubled"
        : "jumped";
  const scope = "the Australian brands we monitored for both months";
  return {
    verb,
    // NOT "one actor registering in bulk" (targeting-copy.ts rule 3): nothing
    // in a month-over-month count says how many people are behind it.
    sentence: `${name} was the month's sharpest riser among ${scope}: its lookalike domains ${verb}, from ${m.priorClones} last month to ${m.clones}. A jump that size is worth a look: it is registration activity concentrating on one brand rather than spreading evenly.`,
    lead: `Up from ${m.priorClones} last month to ${m.clones} — the sharpest single-brand rise among ${scope}.`,
  };
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
