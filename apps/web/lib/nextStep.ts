/**
 * "Best next step" resolver for the Next Steps reporting funnel.
 *
 * Pure and synchronous — no network, no DB — so it adds zero latency to the
 * analyze hot path and can be re-run client-side when the user changes their
 * location or answers the loss/PII micro-question. It returns an ORDERED list
 * of ReportingActions (the single best destination first, a short secondary
 * after); NextStepsCard decides how many to surface prominently.
 *
 * This is the "what do I do right now" nudge only. The deeper, logged,
 * multi-destination flow stays in OnwardReportPicker / the
 * get_onward_destinations RPC. All contact DATA lives in ./onward/destinations
 * (single source of truth); this module holds only the tier LOGIC.
 *
 * Routing model (research-grounded — see the onward-reporting notes in the
 * root CLAUDE.md): danger → loss/identity → brand → intel. State is used only
 * for the NSW identity-support exception + an informational police fallback;
 * per-state police routing is redundant (every state page funnels to
 * ReportCyber). Sensitive scam types (sextortion / image-based) route to
 * eSafety with a safety-first tone instead of generic scam framing.
 */
import type { ReportingAction, Verdict } from "@askarthur/types";
import {
  ACTION_000,
  ACTION_BANK,
  ACTION_REPORTCYBER,
  ACTION_ESAFETY,
  ACTION_IDCARE,
  ACTION_SCAMWATCH,
  ACTION_ID_SUPPORT_NSW,
  BRAND_ROUTES,
  STATE_POLICE_FALLBACK,
  normaliseBrandKey,
  isSensitiveScamType,
  isActiveThreatScamType,
} from "./onward/destinations";

/** What the user told us via the card's micro-question, if anything. */
export type LossState = "money" | "details" | "neither" | null;

export interface RoutingContext {
  verdict: Verdict;
  scamType: string | null;
  impersonatedBrand: string | null;
  channel: string | null;
  /** ISO alpha-2, e.g. "AU". Null/undefined is treated as AU (AU-first). */
  countryCode: string | null;
  /** AU state code from parseStateFromRegion, e.g. "NSW". */
  stateCode: string | null;
  /** From the card's three-tap question; null before the user answers. */
  lossState?: LossState;
}

// Non-AU degradation — never a dead end. Data-only to add a country later.
const GENERIC_INTERNATIONAL: ReportingAction = {
  kind: "info",
  label: "Report to your local police or national cybercrime authority",
  value:
    "Contact your country's official cybercrime or consumer-protection body to report this scam.",
  description: "Search for your national scam-reporting service.",
  priority: 50,
};

function isAU(countryCode: string | null): boolean {
  return countryCode === null || countryCode === undefined || countryCode === "AU";
}

/**
 * Resolve the ordered best-report actions for a verdict. Guaranteed non-empty
 * for any non-SAFE verdict. Deduped by `value`, sorted by priority (urgent
 * floats up via its low priority band).
 */
export function resolveBestNextStep(ctx: RoutingContext): ReportingAction[] {
  if (ctx.verdict === "SAFE") return [];

  const actions: ReportingAction[] = [];

  // Non-AU short-circuits FIRST: every AU destination (000, eSafety, IDCARE,
  // Scamwatch, brand routes) is Australia-only and would misdirect a non-AU
  // user — including for sensitive scams, where the eSafety Commissioner /
  // 000 don't apply outside Australia.
  if (!isAU(ctx.countryCode)) {
    actions.push(GENERIC_INTERNATIONAL);
    return finalise(actions);
  }

  // Sensitive scams (AU): safety-first, eSafety-led. Do not surface generic
  // "report this scam" framing. Virtual kidnapping / sextortion also pin 000.
  if (isSensitiveScamType(ctx.scamType)) {
    actions.push(ACTION_000, ACTION_ESAFETY, ACTION_IDCARE);
    return finalise(actions);
  }

  // ── AU, non-sensitive ──────────────────────────────────────────────────

  // Urgent 000 pin only for HIGH_RISK active-threat patterns.
  if (ctx.verdict === "HIGH_RISK" && isActiveThreatScamType(ctx.scamType)) {
    actions.push(ACTION_000);
  }

  const brandKey = normaliseBrandKey(ctx.impersonatedBrand);
  const brandActions = brandKey ? BRAND_ROUTES[brandKey] ?? [] : [];

  switch (ctx.lossState) {
    case "money":
      // Time-critical: stop the transfer, then the police-connected report.
      actions.push(ACTION_BANK, ACTION_REPORTCYBER, ...brandActions);
      break;
    case "details":
      // Identity/credentials given — police report + identity recovery.
      actions.push(ACTION_REPORTCYBER, ...brandActions, ACTION_IDCARE);
      if (ctx.stateCode === "NSW") actions.push(ACTION_ID_SUPPORT_NSW);
      break;
    case "neither":
      // No loss — intelligence report, plus tell the brand if impersonated.
      actions.push(...brandActions, ACTION_SCAMWATCH);
      break;
    default:
      // Not answered yet — brand route (if any) is the best pre-question link,
      // Scamwatch as the always-safe baseline.
      actions.push(...brandActions, ACTION_SCAMWATCH);
      break;
  }

  // Always guarantee a national baseline so the list is never empty and the
  // user always has an intelligence destination.
  if (!actions.some((a) => a.value === ACTION_SCAMWATCH.value)) {
    actions.push(ACTION_SCAMWATCH);
  }

  // Informational "your state police" fallback (never primary).
  if (ctx.stateCode && STATE_POLICE_FALLBACK[ctx.stateCode]) {
    actions.push(STATE_POLICE_FALLBACK[ctx.stateCode]);
  }

  return finalise(actions);
}

/** Dedupe by value, stable-sort by priority (urgent floats up via low band). */
function finalise(actions: ReportingAction[]): ReportingAction[] {
  const seen = new Set<string>();
  const deduped = actions.filter((a) => {
    if (seen.has(a.value)) return false;
    seen.add(a.value);
    return true;
  });
  return deduped
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.priority - y.a.priority || x.i - y.i)
    .map(({ a }) => a);
}
