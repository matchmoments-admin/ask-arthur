import type { CloneWatchReportCard } from "@/lib/clone-watch/report-card-data";
import { prettyBrand } from "@/lib/clone-watch/brand-display";

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
 * never the body.
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
    "Not confirmed scams — lookalike domains: freshly-registered web addresses built to resemble a real brand. We sweep new domain registrations against ~50 major Australian brands every day and review the matches by hand.";

  // ── Findings (numbered; count adapts) ─────────────────────────────────────
  const findings: string[] = [];

  // Finding 1 — top AU brands. Drop the super-fund brand from the "close behind"
  // list when it gets its own spotlight in finding 2, so it isn't named twice.
  const sfName = card.superFund ? prettyBrand(card.superFund.brand) : null;
  if (au.length > 0) {
    const lead = au[0];
    const rest = au
      .slice(1)
      .filter((b) => b.name !== sfName)
      .slice(0, 4)
      .map((b) => `${b.name} (${b.n})`);
    const restClause = rest.length ? `, with ${joinAnd(rest)} close behind` : "";
    findings.push(
      `${lead.name} was the most-copied Australian brand (${lead.n} lookalike domains)${restClause}.`,
    );
  }

  // Finding 2 — super-fund angle if a fund appears (keeps slide 3 + caption in
  // lockstep); else a global-brands finding when globals exist.
  const globals = card.globalBrands.map((b) => ({ name: prettyBrand(b.brand), n: b.clones }));
  if (card.superFund) {
    const fund = prettyBrand(card.superFund.brand);
    findings.push(
      `It's not just shopping — or banking. ${fund}, an industry super fund, was ${rankPhrase(card.superFund.auRank)} Australian brand (${card.superFund.clones}). Retirement savings are a front-line target now; one super-fund login can open a lifetime of savings.`,
    );
  } else if (globals.length > 0) {
    const top = globals.slice(0, 3).map((b) => `${b.name} (${b.n})`);
    findings.push(
      `It's not just local brands. Global names were aimed at Australians too — ${joinAnd(top)} among the most-cloned.`,
    );
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
      ? `${cap(numberWord(findings.length))} things stood out this month:\n\n` +
        findings.map((f, i) => `${i + 1}. ${f}`).join("\n\n")
      : "";

  // Optional standalone globals sentence (only if globals exist and weren't
  // already promoted into a finding by the no-super-fund branch).
  const globalsLine =
    card.superFund && globals.length > 0
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
    const dir = card.mom.totalDelta > 0 ? "up" : card.mom.totalDelta < 0 ? "down" : "flat";
    const pct = totalPct != null ? `${Math.abs(totalPct)}%` : "";
    seriesLine =
      dir === "flat"
        ? `That's flat on ${priorLabel} (${priorTotal} → ${card.total}). We publish this every month — the trend is the story.`
        : `That's ${dir} ${pct} on ${priorLabel} (${priorTotal} → ${card.total}). We publish this every month — the trend is the story.`;
  }

  const body = [
    hook,
    method,
    findingsBlock,
    globalsLine,
    STATIC_LESSON,
    scamwatchCta,
    seriesLine,
    STATIC_CLOSING_Q,
    STATIC_DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n\n");

  // ── Hashtags (lead tag rotates on the standout) ───────────────────────────
  const leadTag = card.superFund ? "#Superannuation" : "#FraudPrevention";
  const hashtags = ["#ScamAwareness", "#CyberSecurity", "#Australia", leadTag];

  // ── First comment (pasted by hand — the link never goes in the body) ──────
  const firstComment = [
    "Check any link, text or number yourself → https://askarthur.au (free, no signup).",
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
