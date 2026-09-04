/**
 * Arthur's Take — "what to do about this pattern".
 *
 * These are NOT model output. Advice carries legal and safety weight, it has
 * to be consistent between two posts about the same scam, and it has to be
 * changeable without regenerating anything — so it is a curated map keyed on
 * the classifier's intent label. The model contributes only what genuinely
 * needs the post: the tells and the local angle. See
 * docs/arthurs-take/DECISIONS.md X8.
 *
 * Australian destinations are imported from lib/onward/destinations.ts rather
 * than re-declared. That module is the single source of truth for reporting
 * URLs and phone numbers (CLAUDE.md § Onward reporting), and a second copy of
 * the IDCARE number is exactly the kind of drift that outlives the person who
 * introduced it.
 *
 * The feed is ~98% non-Australian, so each entry pairs its AU destination with
 * an international one. Nothing here is jurisdiction-detected — both are shown
 * and labelled, because guessing a reader's country from a scam post's
 * language is a worse failure than one extra line.
 */
import type { IntentLabel, ReportingAction } from "@askarthur/types";

export type { IntentLabel };

import {
  ACTION_BANK,
  ACTION_ESAFETY,
  ACTION_IDCARE,
  ACTION_REPORTCYBER,
  ACTION_SCAMWATCH,
} from "@/lib/onward/destinations";

export interface TakeAction {
  /** Imperative, protective, and about the pattern — never about the poster. */
  label: string;
  description: string;
  href?: string;
  /**
   * The actionable payload, carried through from ReportingAction.value: a
   * phone number for a `call`, the guidance text for an `info`. An earlier
   * version of this adapter dropped it, so "Call IDCARE (free identity
   * support)" rendered with no number to call and "Call your bank's fraud
   * line" rendered with none of the advice about WHICH number to use. Both
   * are the entire content of those actions.
   */
  value?: string;
  /** `call` renders a tel: link, `info` renders text, `url` renders an href. */
  actionKind?: "call" | "url" | "info" | "email" | "copy";
  /** Renders as an urgent callout. Carried through, not re-derived. */
  urgent?: boolean;
  /** Shown with a jurisdiction chip when set. */
  region?: "AU" | "international";
  /** From destinations.ts. Lower is shown first; see its priority bands. */
  priority?: number;
  /**
   * `protective` = what a reader can do about this pattern now.
   * `reporting`  = where to send it.
   * The UI renders them as two groups, and the distinction is not derivable
   * from `region`: some protective steps are AU-specific too (checking an
   * ASIC licence), so filtering by region alone mixes advice into the
   * reporting list.
   */
  kind: "protective" | "reporting";
}

// ── International reporting destinations ─────────────────────────────────
// Deliberately kept to the three English-language national bodies that
// actually accept public scam reports, rather than a long list nobody checks.

const ACTION_FTC: TakeAction = {
  label: "Report to the FTC (United States)",
  description: "reportfraud.ftc.gov collects US consumer fraud reports.",
  href: "https://reportfraud.ftc.gov/",
  region: "international",
  kind: "reporting",
};

const ACTION_FRAUD_UK: TakeAction = {
  label: "Report to Action Fraud (United Kingdom)",
  description: "The UK's national fraud and cybercrime reporting centre.",
  href: "https://www.actionfraud.police.uk/",
  region: "international",
  kind: "reporting",
};

const ACTION_CAFC: TakeAction = {
  label: "Report to the CAFC (Canada)",
  description: "The Canadian Anti-Fraud Centre takes reports from the public.",
  href: "https://antifraudcentre-centreantifraude.ca/",
  region: "international",
  kind: "reporting",
};

/** Every take offers a way to report somewhere, wherever the reader is. */
const INTERNATIONAL_REPORTING: TakeAction[] = [
  ACTION_FTC,
  ACTION_FRAUD_UK,
  ACTION_CAFC,
];

function fromReportingAction(
  action: ReportingAction,
  region: "AU" = "AU",
): TakeAction {
  return {
    label: action.label,
    description: action.description ?? "",
    href: action.kind === "url" ? action.value : undefined,
    // Everything below is carried through rather than dropped. `value` is the
    // action's whole point for a `call` or `info`; `priority` is the ordering
    // destinations.ts already declares, so re-encoding it here by hand would
    // be a second source of truth for the same decision.
    value: action.value,
    actionKind: action.kind,
    urgent: action.urgent,
    priority: action.priority,
    region,
    kind: "reporting",
  };
}

// ── Protective steps, per pattern ────────────────────────────────────────
// One or two per label. Phrased as what to do about the pattern, in the
// register the ACCC and IDCARE use: plain, specific, not alarmist.

const PROTECTIVE: Record<IntentLabel, TakeAction[]> = {
  phishing: [
    {
      label: "Open the site yourself, never from the message",
      description:
        "Type the address or use a saved bookmark. A link in an unexpected message is the part of this pattern that does the work.",
      kind: "protective",
    },
    {
      label: "Turn on two-factor authentication",
      description:
        "It keeps an account reachable even after a password has been given away.",
      kind: "protective",
    },
  ],
  romance_scam: [
    {
      label: "Treat a request for money as the point of the relationship",
      description:
        "In this pattern the affection is the setup; the first request is rarely the last.",
      kind: "protective",
    },
    {
      label: "Check whether the photos exist elsewhere",
      description:
        "A reverse image search often finds the same face on an unrelated profile.",
      kind: "protective",
    },
  ],
  investment_fraud: [
    {
      label: "Check the licence before the returns",
      description:
        "In Australia, search ASIC's registers and its Investor Alert List. A guaranteed return is a claim no licensed adviser makes.",
      href: "https://asic.gov.au/online-services/search-asics-registers/",
      region: "AU",
      kind: "protective",
    },
    {
      label: "Be wary if you cannot withdraw",
      description:
        "A platform that shows growing profits but adds fees or taxes before a withdrawal is describing this pattern.",
      kind: "protective",
    },
  ],
  tech_support: [
    {
      label: "Hang up and call the company yourself",
      description:
        "No legitimate provider opens with an unsolicited call about a virus on your machine.",
      kind: "protective",
    },
    {
      label: "Never grant remote access on request",
      description:
        "Remote-desktop tools are the mechanism here; once granted, the session is not observable by you.",
      kind: "protective",
    },
  ],
  impersonation: [
    {
      label: "Verify through a channel you already had",
      description:
        "Use a number or address you held before the message arrived, not one it supplied.",
      kind: "protective",
    },
  ],
  shopping_scam: [
    {
      label: "Prefer a payment method with a chargeback",
      description:
        "Bank transfer, gift cards and crypto have no recovery path — which is why this pattern asks for them.",
      kind: "protective",
    },
    {
      label: "Check how old the storefront is",
      description:
        "A brand-new domain with deep discounts on scarce goods is the shape of this scam.",
      kind: "protective",
    },
  ],
  phone_scam: [
    {
      label: "Let unknown numbers go to voicemail",
      description:
        "Caller ID can be spoofed, so the number showing on your screen is not evidence of who is calling.",
      kind: "protective",
    },
  ],
  email_scam: [
    {
      label: "Check the sending domain, not the display name",
      description:
        "The display name is free text. The domain after the @ is the part that is hard to fake.",
      kind: "protective",
    },
  ],
  sms_scam: [
    {
      label: "Do not tap links in unexpected texts",
      description:
        "Delivery, toll and bank texts are the common covers for this pattern.",
      kind: "protective",
    },
  ],
  employment_scam: [
    {
      label: "A real employer never asks you to pay",
      description:
        "Fees for equipment, training or a background check run the wrong way in a genuine job.",
      kind: "protective",
    },
    {
      label: "Do not accept money to move on",
      description:
        "Being asked to receive funds and forward them is money-muling, whatever the role is called.",
      kind: "protective",
    },
  ],
  advance_fee: [
    {
      label: "Nothing legitimate needs a fee to release your own money",
      description:
        "Shipping, tax, insurance and 'release' fees are the same step wearing different names.",
      kind: "protective",
    },
  ],
  rental_scam: [
    {
      label: "Inspect before you pay anything",
      description:
        "A landlord who cannot let you see the property, and needs a deposit today, is describing this pattern.",
      kind: "protective",
    },
  ],
  sextortion: [
    {
      label: "Do not pay, and do not reply",
      description:
        "Payment marks you as responsive and the demands continue. You have not done anything wrong.",
      kind: "protective",
    },
    {
      label: "Keep the messages",
      description:
        "Screenshots and account details are what a report needs; blocking first destroys them.",
      kind: "protective",
    },
  ],
  informational: [],
  other: [],
};

/**
 * Reporting destinations by pattern. Sextortion routes to eSafety rather than
 * Scamwatch — the need is content removal and support, not consumer-fraud
 * intelligence. Identity-exposing patterns add IDCARE. Anything where money
 * has plausibly moved leads with the bank, because that is the only step with
 * a time limit on it.
 */
function reportingFor(label: IntentLabel): TakeAction[] {
  const scamwatch = fromReportingAction(ACTION_SCAMWATCH);
  const reportCyber = fromReportingAction(ACTION_REPORTCYBER);
  const idcare = fromReportingAction(ACTION_IDCARE);
  const bank = fromReportingAction(ACTION_BANK);

  switch (label) {
    case "sextortion":
      return [fromReportingAction(ACTION_ESAFETY), reportCyber];
    case "phishing":
    case "impersonation":
      return [idcare, scamwatch];
    case "investment_fraud":
    case "advance_fee":
    case "shopping_scam":
    case "rental_scam":
    case "employment_scam":
      return [bank, scamwatch];
    case "tech_support":
      return [bank, idcare, scamwatch];
    case "informational":
    case "other":
      return [scamwatch];
    default:
      return [scamwatch];
  }
}

/**
 * The full action list for a take: protective steps first (they are what a
 * reader can act on now), then where to report.
 *
 * `isScamReport === false` returns protective context only — offering "report
 * this scam" under a take that says it does not read as a scam is incoherent.
 */
export function actionsForTake(
  label: IntentLabel,
  opts: { isScamReport?: boolean } = {},
): TakeAction[] {
  const protective = PROTECTIVE[label] ?? [];
  if (opts.isScamReport === false) return protective;
  // Reporting order comes from destinations.ts's priority bands (0-9 urgent,
  // 10-19 police-connected, 40-49 identity support, 50-59 intel), not from the
  // order they happen to be listed in reportingFor. International routes sort
  // last: they are a fallback for a reader outside Australia, not a competing
  // first choice.
  const reporting = [...reportingFor(label)].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
  );
  return [...protective, ...reporting, ...INTERNATIONAL_REPORTING];
}

export const INTERNATIONAL_ACTIONS = INTERNATIONAL_REPORTING;
