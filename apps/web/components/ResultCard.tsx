"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, CircleX, Eye, HandCoins, ShoppingBag, TriangleAlert } from "lucide-react";
import ResultFeedback from "./result/ResultFeedback";
import ResultActionButtons from "./result/ResultActionButtons";
import OnwardReportPicker from "./result/OnwardReportPicker";
import DeepShopCheckTray from "./result/DeepShopCheckTray";
import NextStepsCard from "./NextStepsCard";
import { AnalysisChecksSummary } from "./AnalysisProgress";
import type { EvidenceContext } from "@/lib/onward/destinations";
import { buildCharityCheckHref } from "@/lib/charity-check-href";
import type { ReportingAction, ScammerContacts, ShopSignal, Verdict } from "@askarthur/types";
import { COMMERCE_FLAG_LABELS } from "@askarthur/types";

interface ResultCardProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
  isVoipCaller?: boolean;
  scamType?: string;
  impersonatedBrand?: string;
  scammerContacts?: ScammerContacts;
  scammerUrls?: Array<{ url: string; isMalicious: boolean; sources: string[] }>;
  channel?: string;
  inputMode?: string;
  onCheckAnother?: () => void;
  contentHash?: string;
  analysisId?: string;
  scamReportId?: number;
  /** Capability handle from /api/analyze (`analysisRef`). Present on the web
   *  checker, where the scam_reports row is written asynchronously and so has
   *  no numeric id at render time. Callers that already hold a persisted id
   *  (none today) may pass `scamReportId` instead; either one enables the
   *  report CTA. */
  analysisRef?: string;
  /** v0.2e charity-intent CTA. When the analyze route detected
   *  charity-shaped input (keyword or 11-digit ABN), this object surfaces
   *  whatever was extractable so we can deep-link the user into the
   *  dedicated /charity-check page pre-filled. Renders as a banner
   *  ABOVE the verdict so users see the more-specific tool first. */
  charityIntent?: {
    detected: true;
    extractedAbn?: string;
    extractedName?: string;
  };
  /** When provided, the charity-intent CTA runs the register check INLINE
   *  (no page hop) via this callback instead of deep-linking; the
   *  /charity-check deep-link is demoted to a secondary "full check" link
   *  for the guided questions (payment method, in-person ID). Wired from
   *  ScamChecker's existing inline charity flow. */
  onCharityCheck?: (intent: { name?: string; abn?: string }) => void;
  /** Shop Guard Stage 0 — when the input looked commerce-shaped, surface
   *  the deduplicated commerce-flag chip row beneath the verdict. Plan:
   *  docs/plans/shop-guard-v2.md. */
  shopSignal?: ShopSignal;
  /** The commerce URL from the submission. When present alongside
   *  shopSignal, the Deep Shop Check tray (Stage 1) renders below the
   *  chip row. */
  commerceUrl?: string;
  /** Next Steps funnel — server-computed best-report actions (present only
   *  when FF_NEXT_STEPS_ROUTING is on). Their presence gates NextStepsCard;
   *  the card recomputes client-side from the routing context so the
   *  micro-question + change-location work without a round-trip. */
  bestNextStep?: ReportingAction[];
  /** Server-derived AU jurisdiction seed for NextStepsCard. */
  stateCode?: string | null;
  /** Labels of the analysis steps that actually ran, surfaced as the collapsed
   *  "Checked against known scams" row inside the verdict panel. Pass
   *  `V2_STEP_LABELS` from AnalysisProgress ONLY on paths that ran those four
   *  steps — the media path does not, and claiming checks that never happened
   *  is the dishonesty AnalysisProgress already guards against. */
  completedChecks?: string[];
}

interface VerdictStyle {
  baseTitle: string;
  icon: LucideIcon;
  chipBg: string;
  chipBorder: string;
  iconColor: string;
  flagBar: string;
  /** Short uppercase risk label for the badge pill. */
  badgeLabel: string;
  /** The safety instruction under the headline. Deliberately STATIC rather
   *  than model output — this is the one line that has to be right even when
   *  the summary is vague. */
  directive: string;
  /** Text colour that stays legible ON the tinted verdict panel. The `*-text`
   *  tokens used for icons are too light for that (warn-text on warn-bg is
   *  ~2.6:1), so the accent uses the darker `*-heading` tokens. */
  accentText: string;
}

// Token-driven verdict styling. Two amber levels (low-risk + suspicious) +
// red for high-risk. Never say "safe" — the lightest tier still nudges the
// user to verify. Tokens are defined in apps/web/app/globals.css:35–44.
const VERDICT_CONFIG: Record<Verdict, VerdictStyle> = {
  SAFE: {
    baseTitle: "No clear red flags — still proceed with caution",
    icon: Eye,
    chipBg: "bg-warn-bg/40",
    chipBorder: "border-warn-border/70",
    iconColor: "text-warn-text",
    flagBar: "bg-warn-text",
    badgeLabel: "No red flags",
    directive:
      "Nothing obvious stood out — still verify through official channels before you pay or share anything.",
    accentText: "text-safe-heading",
  },
  UNCERTAIN: {
    baseTitle: "We can't confirm this is safe — verify before acting",
    icon: Eye,
    chipBg: "bg-slate-50",
    chipBorder: "border-slate-300",
    iconColor: "text-gov-slate",
    flagBar: "bg-gov-slate",
    badgeLabel: "Unclear",
    directive:
      "Don't act on this yet. Verify it through a channel you look up yourself, not one supplied in the message.",
    accentText: "text-gov-slate",
  },
  SUSPICIOUS: {
    baseTitle: "This looks suspicious",
    icon: TriangleAlert,
    chipBg: "bg-warn-bg",
    chipBorder: "border-warn-border",
    iconColor: "text-warn-heading",
    flagBar: "bg-warn-heading",
    badgeLabel: "Suspicious",
    directive:
      "Don't click any links or share details until you've verified this another way.",
    accentText: "text-warn-heading",
  },
  HIGH_RISK: {
    baseTitle: "This looks like a scam",
    icon: CircleX,
    chipBg: "bg-danger-bg",
    chipBorder: "border-danger-border",
    iconColor: "text-danger-text",
    flagBar: "bg-danger-text",
    badgeLabel: "High risk",
    directive:
      "Don't reply, click any links, or send money or personal details.",
    accentText: "text-danger-heading",
  },
};

/** Red flags shown before the "show all" toggle. Claude routinely returns ten;
 *  rendering all of them at full size turns the answer into a wall of red and
 *  pushes the reporting route below three screens of scrolling. */
const FLAG_PREVIEW_COUNT = 5;

function resolveTitle(verdict: Verdict, scamType: string | undefined): string {
  const base = VERDICT_CONFIG[verdict].baseTitle;
  if (verdict !== "HIGH_RISK") return base;
  const t = (scamType ?? "").trim().toLowerCase();
  if (!t || t === "none" || t === "unknown") return base;
  const withScam = /scam$/.test(t) ? t : `${t} scam`;
  return `This looks like a ${withScam}`;
}

// Claude currently returns redFlags as flat strings. Split on the first
// sentence boundary so we can render a bold heading + muted body like the
// competitor layout. Heuristic only — the upstream prompt can later return
// {heading, body} shapes and this helper retires.
function splitFlag(flag: string): { heading: string; body: string } {
  const trimmed = flag.trim();
  const match = trimmed.match(/^([^.:!?]+)[.:!?]\s+([\s\S]+)$/);
  if (match) {
    return { heading: match[1].trim(), body: match[2].trim() };
  }
  return { heading: trimmed, body: "" };
}

export default function ResultCard({
  verdict,
  summary,
  redFlags,
  scamType,
  impersonatedBrand,
  scammerContacts,
  scammerUrls,
  channel,
  countryCode,
  onCheckAnother,
  contentHash,
  analysisId,
  scamReportId,
  analysisRef,
  charityIntent,
  onCharityCheck,
  shopSignal,
  commerceUrl,
  bestNextStep,
  stateCode,
  completedChecks,
}: ResultCardProps) {
  const config = VERDICT_CONFIG[verdict];
  const title = resolveTitle(verdict, scamType);
  const Icon = config.icon;
  // Picker is only useful when we have a scam_reports row to attach the
  // onward log entries to; otherwise the picker has nothing to forward.
  // The report CTA needs SOME handle on the scam_reports row. Historically it
  // required a numeric `scamReportId`, which the web checker never had — the
  // row is written asynchronously — so this was permanently false and
  // onward_report_log stayed empty for the platform's entire history. An
  // `analysisRef` is now an equally valid handle; it is exchanged for the id
  // on click, by which time the durable write has landed.
  // Gated on `analysisRef` specifically: it is both the handle used to resolve
  // the id and the capability the onward route authorises on, so a caller
  // holding only a numeric id could not complete a submission anyway.
  const showReport = verdict !== "SAFE" && typeof analysisRef === "string";
  const [showPicker, setShowPicker] = useState(false);
  const [showAllFlags, setShowAllFlags] = useState(false);
  // Resolved lazily from `analysisRef`; seeded when a caller passed an id.
  const [resolvedReportId, setResolvedReportId] = useState<number | null>(
    typeof scamReportId === "number" ? scamReportId : null,
  );
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);

  /**
   * Exchange the analysis ref for the persisted report id.
   *
   * A 404 means the durable write has not landed yet, which is normal within
   * the first moment after a verdict — so retry a few times with a short
   * backoff rather than telling the user something went wrong.
   */
  async function resolveReportId(ref: string): Promise<number | null> {
    const delaysMs = [0, 600, 1200, 2000];
    for (const delay of delaysMs) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await fetch(`/api/report/by-ref/${encodeURIComponent(ref)}`);
        if (res.ok) {
          const data = (await res.json()) as { scamReportId?: number };
          if (typeof data.scamReportId === "number") return data.scamReportId;
        }
        // Anything other than "not yet written" will not fix itself.
        if (res.status !== 404) return null;
      } catch {
        // Network blip — the next attempt covers it.
      }
    }
    return null;
  }

  async function handleReport() {
    if (resolving) return; // the exchange can take a moment; ignore re-clicks
    setResolveFailed(false);

    // Resolve the report id first, so the feedback row below can carry it.
    // Linking feedback to its analysis is what makes accuracy measurable: at
    // the time of writing, all 22 verdict_feedback rows in production had a
    // NULL scam_report_id, so nothing could learn from them.
    let reportId = resolvedReportId;
    if (reportId == null && analysisRef) {
      setResolving(true);
      reportId = await resolveReportId(analysisRef);
      setResolving(false);
      if (reportId != null) setResolvedReportId(reportId);
    }

    // Audit: write a 'user_reported' verdict_feedback row regardless of
    // which destinations the user later picks. This preserves the existing
    // analytics signal (how many users hit the report button).
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdictGiven: verdict,
          userSays: "user_reported",
          analysisId,
          scamReportId: reportId ?? undefined,
          contentHash,
          locale:
            typeof navigator !== "undefined"
              ? navigator.language || "en-AU"
              : "en-AU",
        }),
      });
    } catch {
      // Best-effort — matches ResultFeedback's fire-and-forget pattern.
    }

    if (reportId == null) {
      // The row genuinely never appeared. Say so rather than opening a picker
      // that cannot submit; NextStepsCard above still gives the user a real
      // next action, so they are not stranded.
      setResolveFailed(true);
      return;
    }
    setShowPicker(true);
  }

  // Build the evidence context once and reuse for the picker + summary.
  const evidence: EvidenceContext = {
    // Uses the RESOLVED id — the evidence bundle sent to regulators and brands
    // must carry the real reference, not "ASK-pending".
    reportRef: resolvedReportId
      ? `ASK-${String(resolvedReportId).padStart(6, "0")}`
      : "ASK-pending",
    scamType: scamType ?? null,
    impersonatedBrand: impersonatedBrand ?? null,
    channel: channel ?? null,
    scammerUrls: (scammerUrls ?? []).map((u) => u.url),
    scammerPhones:
      scammerContacts?.phoneNumbers.map((p) => p.value) ?? [],
    scammerEmails:
      scammerContacts?.emailAddresses.map((e) => e.value) ?? [],
    redFlags,
    receivedAt: new Date().toISOString(),
  };

  const flagItems =
    redFlags.length > 0
      ? redFlags.map((f) => splitFlag(f))
      : [
          {
            heading: "Nothing obvious flagged",
            body: "No tool catches everything — verify through official channels before you act.",
          },
        ];

  // /charity-check deep-link pre-filled with whatever charity-intent
  // detection extracted (incl. the mode=abn dead-end fix) — pure helper,
  // unit-tested in __tests__/charityCheckHref.test.ts.
  const charityCheckHref = charityIntent ? buildCharityCheckHref(charityIntent) : null;

  const visibleFlags = showAllFlags
    ? flagItems
    : flagItems.slice(0, FLAG_PREVIEW_COUNT);
  const flagsCollapsible = flagItems.length > FLAG_PREVIEW_COUNT;

  return (
    <div
      role="alert"
      className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      {/* Charity-intent CTA — surfaced ABOVE the generic verdict because the
          register check is more specific to what the user is asking about.
          Verdict still renders below as the safety net. With an
          onCharityCheck handler (the homepage scanner) the check runs INLINE
          — no page hop — and the /charity-check deep-link demotes to a
          secondary "full check" line for the guided questions. Without a
          handler (any other render site) the whole card deep-links as
          before. */}
      {charityIntent && charityCheckHref && (
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          {onCharityCheck ? (
            <button
              type="button"
              onClick={() =>
                onCharityCheck({
                  name: charityIntent.extractedName,
                  abn: charityIntent.extractedAbn,
                })
              }
              className="w-full flex items-center justify-between gap-3 rounded-lg border-2 border-deep-navy bg-deep-navy/5 px-4 py-3 text-deep-navy hover:bg-deep-navy/10 transition text-left"
            >
              <div className="flex items-center gap-3">
                <HandCoins size={24} className="shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold leading-tight">
                    This looks like a charity request
                  </p>
                  <p className="text-xs text-gov-slate leading-snug mt-0.5">
                    {charityIntent.extractedName
                      ? `Check "${charityIntent.extractedName}" against the ACNC register — right here`
                      : charityIntent.extractedAbn
                        ? `Check ABN ${charityIntent.extractedAbn} against the ACNC register — right here`
                        : "Check it against the ACNC register — right here"}
                  </p>
                </div>
              </div>
              <ArrowRight size={20} className="shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <a
              href={charityCheckHref}
              className="flex items-center justify-between gap-3 rounded-lg border-2 border-deep-navy bg-deep-navy/5 px-4 py-3 text-deep-navy hover:bg-deep-navy/10 transition"
            >
              <div className="flex items-center gap-3">
                <HandCoins size={24} className="shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold leading-tight">
                    This looks like a charity request
                  </p>
                  <p className="text-xs text-gov-slate leading-snug mt-0.5">
                    {charityIntent.extractedName
                      ? `Run a full check on "${charityIntent.extractedName}"`
                      : charityIntent.extractedAbn
                        ? `Run a full check on ABN ${charityIntent.extractedAbn}`
                        : "Run a full check against the ACNC, ABR, and donation-URL safety registers"}
                  </p>
                </div>
              </div>
              <ArrowRight size={20} className="shrink-0" aria-hidden="true" />
            </a>
          )}
          {onCharityCheck && (
            <a
              href={charityCheckHref}
              className="mt-1.5 inline-block text-xs text-gov-slate underline underline-offset-2 hover:text-deep-navy"
            >
              Or run the full check — payment-method and in-person ID questions →
            </a>
          )}
        </div>
      )}

      {/* Verdict panel — tinted and full-bleed, so the risk tier is readable
          before a single word is. Badge + count carry the colour; the headline
          stays deep-navy so it never loses contrast against the tint. */}
      <div className={`border-b px-5 py-5 sm:px-6 ${config.chipBg} ${config.chipBorder}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs font-extrabold uppercase tracking-widest ${config.chipBorder} ${config.accentText}`}
          >
            <Icon size={14} className="shrink-0" aria-hidden="true" />
            {config.badgeLabel}
          </span>
          {redFlags.length > 0 && (
            <span className={`text-sm font-semibold ${config.accentText}`}>
              {redFlags.length} warning sign{redFlags.length === 1 ? "" : "s"}{" "}
              found
            </span>
          )}
        </div>
        <h2 className="mt-3 text-lg font-bold leading-tight text-deep-navy">
          {title}
        </h2>
        {/* Static per-verdict instruction — the one line that must be right
            even when the model summary is vague. */}
        <p className="mt-1.5 text-base leading-relaxed text-gov-slate">
          {config.directive}
        </p>
      </div>

      {/* The four analysis steps, collapsed. Renders only on paths that
          actually ran them (see the `completedChecks` prop doc). */}
      {completedChecks && completedChecks.length > 0 && (
        <AnalysisChecksSummary steps={completedChecks} />
      )}

      {/* Shop Guard Stage 0 — commerce-flag chips. Renders when shopSignal is
          present AND at least one tag was extracted. Empty-flag case (commerce
          detected but no specific tag) renders a single "Online shop detected"
          chip — surfacing the detection itself is part of the measurement
          goal in the 30-day Stage 0 window. */}
      {shopSignal && (
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <ShoppingBag size={16} className="text-gov-slate shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
              Shop signals
            </span>
            {shopSignal.commerceFlags.length === 0 ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-gov-slate">
                Online shop detected
              </span>
            ) : (
              shopSignal.commerceFlags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-warn-border bg-warn-bg/40 px-2 py-0.5 text-xs text-warn-text"
                >
                  {COMMERCE_FLAG_LABELS[tag] ?? tag}
                </span>
              ))
            )}
          </div>

          {/* Deep Shop Check tray (Stage 1) — user-initiated ABN + domain-age +
              reputation enrichment. Renders only with a commerce URL to check. */}
          {commerceUrl && (
            <DeepShopCheckTray commerceUrl={commerceUrl} shopSignal={shopSignal} />
          )}
        </div>
      )}

      {/* Why we think so — the evidence, capped so it reads as a list rather
          than a wall. */}
      <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
        <p className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
          Why we think so
        </p>
        {summary?.trim() && (
          <p className="mt-3 text-base leading-relaxed text-gov-slate">
            {summary.trim()}
          </p>
        )}
        <ul className="mt-2">
          {visibleFlags.map((flag, i) => (
            <li
              key={i}
              className="flex gap-3 border-b border-slate-100 py-3 last:border-b-0"
            >
              <TriangleAlert
                size={18}
                className={`mt-0.5 shrink-0 ${config.accentText}`}
                aria-hidden="true"
              />
              <div>
                <p className="text-base font-bold text-deep-navy leading-snug">
                  {flag.heading}
                </p>
                {flag.body && (
                  <p className="mt-0.5 text-base text-gov-slate leading-relaxed">
                    {flag.body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {flagsCollapsible && (
          <button
            type="button"
            onClick={() => setShowAllFlags((v) => !v)}
            aria-expanded={showAllFlags}
            className="mt-2 inline-flex min-h-[44px] items-center text-sm font-bold text-deep-navy underline underline-offset-4"
          >
            {showAllFlags
              ? "Show fewer"
              : `Show all ${flagItems.length} warning signs`}
          </button>
        )}
      </div>

      {/* Next Steps funnel — geo/brand-aware "what do I do now" routing.
          Renders only when the server attached best-report actions (flag on +
          non-SAFE). The card recomputes client-side from the routing context. */}
      {bestNextStep && bestNextStep.length > 0 && verdict !== "SAFE" && (
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <NextStepsCard
            verdict={verdict}
            scamType={scamType}
            impersonatedBrand={impersonatedBrand}
            channel={channel}
            countryCode={countryCode}
            initialStateCode={stateCode}
            onRouteClick={(action, jurisdiction) => {
              // Metadata-only funnel signal (no PII, no content). Fire-and-forget;
              // the endpoint drops it unless FF_ROUTE_CLICK_TELEMETRY is on.
              void fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  eventType: "reporting_route_click",
                  eventProps: {
                    routeLabel: action.label.slice(0, 120),
                    jurisdiction: jurisdiction ?? "none",
                    scamType: (scamType ?? "unknown").slice(0, 120),
                  },
                  path: "/",
                }),
              }).catch(() => {});
            }}
          />
        </div>
      )}

      <div className="px-5 py-5 sm:px-6">
        {/* Remember disclaimer */}
        <p className="text-sm text-gov-slate leading-relaxed">
          <span className="font-bold text-deep-navy">Remember:</span>{" "}
          Arthur is a free resource to be used alongside your own research and
          best judgment. Always verify information through official channels
          and use caution when clicking links.
        </p>

        {/* Thumbs feedback */}
        <ResultFeedback
          verdictGiven={verdict}
          analysisId={analysisId}
          scamReportId={resolvedReportId ?? undefined}
          contentHash={contentHash}
        />

        {/* Onward report picker — opens inline when user clicks "Report this scam".
            The picker swaps to OnwardReportSummary after the user submits. */}
        {showPicker && resolvedReportId != null && analysisRef && (
          <OnwardReportPicker
            scamReportId={resolvedReportId}
            analysisRef={analysisRef}
            analysisId={analysisId}
            scamType={scamType}
            impersonatedBrand={impersonatedBrand}
            channel={channel}
            evidence={evidence}
            onClose={() => setShowPicker(false)}
          />
        )}

        {resolveFailed && (
          <p className="mt-3 text-sm text-slate-600" role="status">
            We couldn&apos;t attach your report just yet. Your check was still
            recorded — please use the recommended next step above.
          </p>
        )}

        {/* Two-button footer */}
        {onCheckAnother && (
          <ResultActionButtons
            onCheckAnother={onCheckAnother}
            onReport={showReport ? handleReport : undefined}
            showReport={showReport}
            reportPending={resolving}
          />
        )}
      </div>
    </div>
  );
}
