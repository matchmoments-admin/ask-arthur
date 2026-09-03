import type { CloneWatchReportCard } from "@/lib/clone-watch/report-card-data";
import {
  buildClassifierCaveat,
  buildTldLine,
  buildTrendDisclosure,
} from "@/lib/clone-watch/targeting-copy";
import { buildOutcomesBlock } from "@/lib/clone-watch/outcome-copy";
import { prettyBrand } from "@/lib/clone-watch/brand-display";
import { pickFurtherReading } from "@/lib/clone-watch/further-reading";

/**
 * Deterministic evidence-first LinkedIn caption for the monthly Clone Watch
 * post, generated entirely FROM the reconciled report data. Every number comes
 * from getCloneWatchReportCard — the caption never invents a figure — so it
 * always matches the carousel and the digest (the honesty guardrail that makes
 * the post safe to tag Scamwatch / quote).
 *
 * Structure mirrors the hand-authored June edition, with conditional blocks:
 *  - a super-fund finding when a watchlisted fund appears (else a global-brands
 *    finding), so slide 3 (the spotlight) and the caption stay in lockstep;
 *  - a month-on-month line once there's an honest delta (mom.available), else
 *    the "this is month one — floor or trend" baseline framing;
 *  - a rotating lead hashtag (#Superannuation when a fund leads).
 *
 * Voice + guardrails (linkedin-writing skill, client ask-arthur, Voice 2):
 * "lookalike / copycat / detected", never "confirmed clones"; Netcraft =
 * reported, not taken down; registrars in aggregate; link in the FIRST COMMENT,
 * never the body. Vendor OUTCOMES (F5): the paragraph comes from
 * lib/clone-watch/outcome-copy.ts — the single vocabulary module whose header
 * states the honesty rules (exclusive lifecycle states, flip claims only for
 * weaponisedAfterDecline, escalation only when escalated>0).
 */

export interface CloneWatchCaption {
  /** Document title shown as the carousel label, e.g. "Australian Clone Watch — June 2026". */
  documentTitle: string;
  /** The post body (commentary), no hashtags. */
  body: string;
  /** The 4 hashtags, lead tag rotates on the month's standout. */
  hashtags: string[];
  /** body + a blank line + the hashtags — what actually gets posted. */
  bodyWithHashtags: string;
  /** The first comment (pasted by hand — the link never goes in the body). */
  firstComment: string;
}

const NUMBER_WORD = ["zero", "one", "two", "three", "four", "five"];
function numberWord(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "the most-targeted" / "the second most-targeted" / … (spelled out for prose). */
function rankPhrase(rank: number): string {
  if (rank <= 1) return "the most-targeted";
  const ord =
    rank === 2 ? "second" : rank === 3 ? "third" : rank === 4 ? "fourth" : `${rank}th`;
  return `the ${ord} most-targeted`;
}

/** ["a","b","c"] → "a, b and c"; ["a","b"] → "a and b"; ["a"] → "a". */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Caption-friendly registrar name — drops a trailing "(…)" so a parenthetical
 *  canonical name ("GMO Internet (Onamae)") doesn't collide with the "(count)". */
function regShort(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
}

const STATIC_LESSON =
  "The lesson isn't panic. It's that the address bar is the front line. A copycat domain is cheap, fast and disposable — which is why checking the link before you log in or pay matters more than spotting a typo in the message.";
const STATIC_DISCLAIMER =
  "Ask Arthur is a free scam checker. Not affiliated with any bank or government agency.";
const STATIC_CLOSING_Q =
  "Which of these surprised you most — and is there a brand you'd want us watching?";

/**
 * Build the monthly caption from the reconciled report card.
 * @param methodUrl optional — when the /clone-watch/method page is live, its URL
 *   is added to the first comment ("How we count these → …").
 */
export function generateCloneWatchCaption(
  card: CloneWatchReportCard,
  methodUrl?: string,
): CloneWatchCaption {
  const month = card.periodLabel;
  const au = card.topAuBrands.map((b) => ({ name: prettyBrand(b.brand), n: b.clones }));

  // ── Hook ────────────────────────────────────────────────────────────────
  const hook = `In ${month}, we detected ${card.total} newly-registered copycat domains impersonating brands Australians use every day.`;
  const method =
    // Brand count is read from the coverage record FOR THIS MONTH, not
    // hard-coded and not from today's watchlist. The literal it first replaced
    // said "~50" while the list held 293 — a six-fold understatement published
    // every month. Reading `AU_BRAND_WATCHLIST.length` fixed that but left a
    // subtler version: a card can be built for any past month, and the live
    // length only grows, so re-exporting June with today's number overstates
    // what we were actually sweeping then. Rounded down to the nearest ten so
    // it stays true between watchlist edits.
    `Not confirmed scams — lookalike domains: freshly-registered web addresses built to resemble a real brand. We sweep new domain registrations against ${Math.floor(card.watchlistSize / 10) * 10}+ major Australian brands every day and review the matches by hand.`;

  // ── Findings (numbered; count adapts) ─────────────────────────────────────
  const findings: string[] = [];

  // Finding 1 — top AU brands. Drop the super-fund brand from the "close behind"
  // list when it gets its own spotlight in finding 2, so it isn't named twice.
  const sfName = card.superFund ? prettyBrand(card.superFund.brand) : null;
  // When the super fund is itself the #1 AU brand, it IS the lead of finding 1,
  // so fold the super angle into finding 1 and skip the separate spotlight —
  // otherwise the same brand is named twice with two contradictory "#1" claims.
  const fundIsLead = card.superFund != null && card.superFund.auRank === 1;
  if (au.length > 0) {
    const lead = au[0];
    const rest = au
      .slice(1)
      .filter((b) => b.name !== sfName)
      .slice(0, 4)
      .map((b) => `${b.name} (${b.n})`);
    const restClause = rest.length ? `, with ${joinAnd(rest)} close behind` : "";
    findings.push(
      fundIsLead
        ? `A super fund led the month: ${lead.name} was the most-copied Australian brand (${lead.n} lookalike domains)${restClause}. Retirement savings are a front-line target now — one super-fund login can open a lifetime of savings.`
        : `${lead.name} was the most-copied Australian brand (${lead.n} lookalike domains)${restClause}.`,
    );
  }

  // Finding 2 — the month's spotlight, kept in lockstep with slide 3. The
  // subject comes from the news-value ladder (mover → new entrant → super fund
  // → globals) and never repeats last month's, so the series can't tell the
  // same story twice (it did: HESTA led June AND July 2026).
  const globals = card.globalBrands.map((b) => ({ name: prettyBrand(b.brand), n: b.clones }));
  // Tracks whether globals already appeared AS a finding, so the standalone
  // globals sentence can't repeat it. The pre-ladder code got this free from
  // mutually-exclusive branches; the ladder broke that (review finding 6b).
  let usedGlobalsFinding = false;
  const sp = card.spotlight;
  const spName = sp.brand ? prettyBrand(sp.brand) : null;
  const spotlightIsLead = spName != null && au[0]?.name === spName;
  if (sp.kind === "mover" && spName && !spotlightIsLead) {
    const doubled = sp.priorClones != null && sp.priorClones > 0 && sp.clones >= sp.priorClones * 2;
    findings.push(
      // NOT "one actor registering in bulk". Nothing in a month-over-month
      // count says how many people are behind it — that line inferred an actor
      // from a volume change alone, which is a weaker basis than the
      // infrastructure fingerprint we already decline to call an actor
      // (campaign-summary.ts, targeting-copy.ts rule 3). Say what we measured.
      `${spName} was the month's sharpest riser — ${sp.priorClones} lookalike domains last month, ${sp.clones} this month${doubled ? ", more than double" : ""}. A jump that size is worth a look: it is registration activity concentrating on one brand rather than spreading evenly.`,
    );
  } else if (sp.kind === "new_entrant" && spName && !spotlightIsLead) {
    findings.push(
      `${spName} appeared on the map for the first time (${sp.clones} lookalike domains) — it wasn't targeted at all last month. A brand's first month is when its customers are least primed to expect a fake.`,
    );
  } else if (sp.kind === "super_fund" && spName && !fundIsLead) {
    findings.push(
      `It's not just shopping — or banking. ${spName}, an industry super fund, was ${rankPhrase(sp.auRank)} Australian brand (${sp.clones}). Retirement savings are a front-line target now; one super-fund login can open a lifetime of savings.`,
    );
  } else if (globals.length > 0) {
    const top = globals.slice(0, 3).map((b) => `${b.name} (${b.n})`);
    findings.push(
      `It's not just local brands. Global names were aimed at Australians too — ${joinAnd(top)} among the most-cloned.`,
    );
    usedGlobalsFinding = true;
  }

  // Finding 3 — registrar concentration + the WHOIS-privacy caveat.
  const regs = card.topRegistrars;
  if (regs.length > 0) {
    const lead = regs.slice(0, 2).map((r) => `${regShort(r.registrar)} (${r.clones})`);
    findings.push(
      `Most domains hid who was behind them. ${joinAnd(lead)} led the registrars we could trace — but ${card.unknownRegistrarCount} of the ${card.total} sat behind WHOIS privacy, so the real concentration is higher.`,
    );
  }

  const findingsBlock =
    findings.length > 0
      ? `${cap(numberWord(findings.length))} ${findings.length === 1 ? "thing" : "things"} stood out this month:\n\n` +
        findings.map((f, i) => `${i + 1}. ${f}`).join("\n\n")
      : "";

  // Optional standalone globals sentence (only if globals exist and weren't
  // already promoted into a finding by the no-super-fund branch).
  const globalsLine =
    !usedGlobalsFinding && globals.length > 0
      ? `Global brands were aimed at Australians too — ${joinAnd(globals.slice(0, 3).map((b) => `${b.name} (${b.n})`))} among them.`
      : "";

  // ── Scamwatch civic CTA (goal: drive reports) ─────────────────────────────
  const b1 = au[0]?.name ?? "a bank";
  const b2 = au[1]?.name ?? "Australia Post";
  const scamwatchCta = `Got a "${b1}" or "${b2}" text sitting in your phone right now? Report it — to us and to Scamwatch. Every report sharpens next month's map.`;

  // ── Series hook: month-one baseline vs an honest MoM delta ────────────────
  let seriesLine: string;
  if (!card.mom.available) {
    seriesLine = `This is month one. Next month you'll see whether ${card.total} is the floor or the trend.`;
  } else {
    const { totalPct, priorTotal, priorLabel } = card.mom;
    // "flat" when the move rounds to <1% either way, so we never print "up 0%".
    const flat = card.mom.totalDelta === 0 || totalPct == null || totalPct === 0;
    const dir = card.mom.totalDelta > 0 ? "up" : "down";
    seriesLine = flat
      ? `That's essentially flat on ${priorLabel} (${priorTotal} → ${card.total}). We publish this every month — the trend is the story.`
      : `That's ${dir} ${Math.abs(totalPct)}% on ${priorLabel} (${priorTotal} → ${card.total}). We publish this every month — the trend is the story.`;
  }

  // ── Vendor outcomes (F5) — only once the month's cohort has witnessed
  // gradings; all-zero months keep the pre-F5 caption shape exactly.
  const outcomesBlock = buildOutcomesBlock(card.kpis);

  // ── Targeting characterisation (#1075) ────────────────────────────────────
  // Ordered by how defensible each line is, because the 2,900-char cap is
  // enforced by a THROW at prepare time: if something has to go, the least
  // defensible line should be the one that falls off, never the disclosure.
  //
  // The TLD line is the strongest claim in the whole caption — derived from the
  // domain string, no model and no vendor, and directly actionable for a brand.
  const tldLine = buildTldLine(card.targeting.tlds.top, card.targeting.tlds.total);
  // The classifier rejects ~14% of matches as coincidental; publishing the raw
  // count as "lookalikes" without this overstates by that much.
  // Both figures come from the SAME (global) dedupe. Using card.total here
  // would compare a globally-deduped numerator against a per-brand-deduped
  // denominator: a clone matching two brands counts twice on one side and once
  // on the other. Identical on the August cohort, wrong by construction.
  // `rejectedN` counts rows the classifier actually judged coincidental, NOT
  // `tlds.total - tactics.total` — that difference also sweeps in every row it
  // never saw, and would grow silently with classifier lag.
  const classifierCaveat = buildClassifierCaveat(
    card.targeting.tlds.total,
    card.targeting.rejectedN,
  );
  // MANDATORY whenever any month-over-month movement is published, and built
  // from the gate's own counts so it cannot drift from the decision it
  // describes.
  const trendDisclosure = buildTrendDisclosure(card.brandTrends.excluded);

  const body = [
    hook,
    method,
    findingsBlock,
    tldLine,
    globalsLine,
    outcomesBlock,
    classifierCaveat,
    trendDisclosure,
    STATIC_LESSON,
    scamwatchCta,
    seriesLine,
    STATIC_CLOSING_Q,
    STATIC_DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n\n");

  // ── Hashtags (lead tag rotates on the standout) ───────────────────────────
  const leadTag = sp.kind === "super_fund" ? "#Superannuation" : "#FraudPrevention";
  const hashtags = ["#ScamAwareness", "#CyberSecurity", "#Australia", leadTag];

  // ── First comment (pasted by hand — the link never goes in the body) ──────
  // Further reading rotates and, where possible, matches the month's lead story
  // — so each edition teaches something and sends traffic to a different page
  // instead of every month pointing at the same two links.
  const reading = pickFurtherReading(sp.brand || au[0]?.name || null, card.periodMonth);
  const firstComment = [
    "Check any link, text or number yourself → https://askarthur.au (free, no signup).",
    `${reading.label} → https://askarthur.au/blog/${reading.slug}`,
    methodUrl ? `How we count these → ${methodUrl}` : "",
    "Targeted brand and want your full clone list? Partner with us → https://askarthur.au/contact",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    documentTitle: `Australian Clone Watch — ${month}`,
    body,
    hashtags,
    bodyWithHashtags: `${body}\n\n${hashtags.join(" ")}`,
    firstComment,
  };
}
