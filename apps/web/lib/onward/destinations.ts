/**
 * Helpers for the OnwardReportPicker / Summary UI: deep-link builders for
 * "skipped" destinations (Scamwatch, ReportCyber, IDCARE) where the user
 * has to act, and an evidence-block builder that prefills the clipboard
 * with everything they'll need to paste into the destination's form.
 *
 * This module is ALSO the single source of truth for the "Next Steps"
 * best-report routing (NextStepsCard / lib/nextStep.ts). All reporting
 * contact data — national, brand, jurisdiction, eSafety — lives here with
 * a `// source:` comment per entry (verified 2026-07-07; re-fetch before
 * shipping). A test asserts no placeholder strings remain.
 */
import type { ReportingAction } from "@askarthur/types";

export type OnwardDestinationEnum =
  | "scamwatch"
  | "reportcyber"
  | "acma_email_spam"
  | "idcare"
  | "brand_abuse"
  | "ask_arthur_feed"
  | "openphish"
  | "apwg";

export interface DestinationOption {
  destination: OnwardDestinationEnum;
  destination_key: string;
  display_name: string;
  default_enabled: boolean;
  description: string;
  contact_type: string;
}

export interface OnwardResultRow {
  destination: OnwardDestinationEnum;
  destination_key: string;
  display_name: string;
  status: string;
}

export interface EvidenceContext {
  reportRef: string;
  scamType: string | null;
  impersonatedBrand: string | null;
  channel: string | null;
  scammerUrls: string[];
  scammerPhones: string[];
  scammerEmails: string[];
  redFlags: string[];
  receivedAt: string;
}

export const SCAMWATCH_FORM_URL =
  "https://portal.scamwatch.gov.au/report-a-scam/";
export const SCAMWATCH_WEBSITE_FORM_URL =
  "https://forms.scamwatch.gov.au/report-a-scamwebsite/";
export const REPORTCYBER_URL =
  "https://www.cyber.gov.au/report-and-recover/report";
// source: cyber.gov.au — the live person-reporting entry point (the actual
// form a victim starts a cybercrime report in). Every state police force
// funnels here; it auto-routes to the correct jurisdiction and issues a
// reference number. This is the "best link" when money/identity is involved.
export const REPORTCYBER_PERSON_FORM_URL =
  "https://reportapp.cyber.gov.au/person/forms";
export const IDCARE_URL = "https://www.idcare.org/";
export const IDCARE_PHONE = "1800 595 160";
// source: esafety.gov.au — image-based abuse / sextortion / cyberbullying.
// Sensitive scams route here with a safety-first tone (NSW pilot §3), NOT
// through generic scam "analysis".
export const ESAFETY_REPORT_URL = "https://www.esafety.gov.au/report";

export function buildEvidenceBlock(ctx: EvidenceContext): string {
  const lines = [
    `Type of scam:    ${ctx.scamType ?? "—"}`,
    `Impersonated:    ${ctx.impersonatedBrand ?? "n/a"}`,
    `Contacted via:   ${ctx.channel ?? "—"}`,
    "",
  ];
  if (ctx.scammerUrls.length) {
    lines.push(`URLs:`);
    ctx.scammerUrls.forEach((u) => lines.push(`  ${u}`));
  }
  if (ctx.scammerPhones.length) {
    lines.push(`Phones:`);
    ctx.scammerPhones.forEach((p) => lines.push(`  ${p}`));
  }
  if (ctx.scammerEmails.length) {
    lines.push(`Emails:`);
    ctx.scammerEmails.forEach((e) => lines.push(`  ${e}`));
  }
  if (ctx.redFlags.length) {
    lines.push("", "Key red flags:");
    ctx.redFlags.forEach((f) => lines.push(`  • ${f}`));
  }
  lines.push(
    "",
    `Date received:   ${ctx.receivedAt}`,
    `Ask Arthur ref:  ${ctx.reportRef}`
  );
  return lines.join("\n");
}

export function getDeepLink(
  destination: OnwardDestinationEnum,
  hasUrlOnly: boolean = false
): string | null {
  switch (destination) {
    case "scamwatch":
      return hasUrlOnly ? SCAMWATCH_WEBSITE_FORM_URL : SCAMWATCH_FORM_URL;
    case "reportcyber":
      return REPORTCYBER_URL;
    case "idcare":
      return IDCARE_URL;
    default:
      return null;
  }
}

// ── Next Steps "best report" routing data ────────────────────────────────
//
// Priority bands (lower = shown first): 0–9 urgent (000 / bank), 10–19
// national police-connected (ReportCyber), 20–39 brand-specific, 40–49
// identity support (IDCARE / ID Support NSW), 50–59 intel (Scamwatch),
// 60+ informational state-police fallback. lib/nextStep.ts assembles the
// ordered list from these; this module only holds the data.

// Urgent, never auto-actioned — info + tap-to-call only.
export const ACTION_000: ReportingAction = {
  kind: "info",
  label: "In immediate danger? Call 000",
  value: "000",
  description:
    "Only if a crime is happening now or someone is at immediate risk.",
  priority: 0,
  urgent: true,
};
// source: every state police page (VIC/WA/QLD/…) — 000 for danger/in-progress.

export const ACTION_BANK: ReportingAction = {
  kind: "info",
  label: "Call your bank's fraud line now",
  value:
    "Use the number on your card, your statement, or your bank's official website — never a number from the suspicious message.",
  description:
    "If money has moved, your bank may be able to stop or recover it. Do this first.",
  priority: 1,
  urgent: true,
};
// source: Australian Banking Association Scam-Safe Accord — there is no single
// national "report a scam to your bank" line; always the user's own bank.

export const ACTION_REPORTCYBER: ReportingAction = {
  kind: "url",
  label: "Report to ReportCyber (police-connected)",
  value: REPORTCYBER_PERSON_FORM_URL,
  description:
    "Official police channel — gives you a reference number and routes to the right state police.",
  priority: 10,
};

export const ACTION_ESAFETY: ReportingAction = {
  kind: "url",
  label: "Report to eSafety",
  value: ESAFETY_REPORT_URL,
  description:
    "The eSafety Commissioner can help have intimate or abusive content removed. You are not in trouble — support is available.",
  priority: 12,
  urgent: true,
};

export const ACTION_IDCARE: ReportingAction = {
  kind: "call",
  label: "Call IDCARE (free identity support)",
  value: IDCARE_PHONE,
  description:
    "Free national service — a case plan if your identity or details were exposed.",
  priority: 40,
};

export const ACTION_SCAMWATCH: ReportingAction = {
  kind: "url",
  label: "Report to Scamwatch",
  value: SCAMWATCH_FORM_URL,
  description:
    "Reports the scam to the National Anti-Scam Centre. Helps warn others — not a police report.",
  priority: 50,
};

// NSW is the only jurisdiction running a distinct identity-recovery service
// worth special-casing; every other state routes identity support to IDCARE.
export const ACTION_ID_SUPPORT_NSW: ReportingAction = {
  kind: "call",
  label: "Call ID Support NSW",
  value: "1800 001 040",
  description:
    "NSW Government identity-recovery service — free help if your ID documents or data were misused.",
  priority: 41,
};
// source: nsw.gov.au/departments-and-agencies/id-support-nsw/contact

// Brand-impersonation routes. Keyed by normalised brand key (see
// normaliseBrandKey). Surfaced prominently — a victim who "got an ATO text"
// completes "report to the ATO" far more often than a generic gov form.
export const BRAND_ROUTES: Record<string, ReportingAction[]> = {
  ato: [
    {
      kind: "email",
      label: "Report the scam to the ATO",
      value: "ReportScams@ato.gov.au",
      description: "Forward the suspicious message, then delete it.",
      priority: 20,
      emailSubject: "Suspected ATO impersonation scam",
      emailBody:
        "I received the following suspicious message claiming to be from the ATO:\n\n[paste the message here]\n",
    },
    // source: ato.gov.au/online-services/scams-cyber-safety-and-identity-protection/verify-or-report-an-ato-scam
    {
      kind: "call",
      label: "Verify or report by phone (ATO)",
      value: "1800 008 540",
      description: "Check whether contact was genuinely from the ATO.",
      priority: 21,
    },
  ],
  services_australia: [
    {
      kind: "call",
      label: "Scams & Identity Theft Helpdesk",
      value: "1800 941 126",
      description:
        "Call if you clicked a link or gave myGov / Centrelink / Medicare details (Mon–Fri).",
      priority: 20,
    },
    // source: servicesaustralia.gov.au/report-services-australia-or-mygov-scam
    {
      kind: "email",
      label: "Report a myGov / Services Australia scam",
      value: "reportascam@servicesaustralia.gov.au",
      description: "Report a scam impersonating myGov, Medicare or Centrelink.",
      priority: 21,
    },
  ],
  australia_post: [
    {
      kind: "email",
      label: "Report the scam to Australia Post",
      value: "scams@auspost.com.au",
      description: "Forward the suspicious email, SMS or message.",
      priority: 20,
    },
    // source: auspost.com.au/about-us/about-our-site/online-security-scams-fraud
    // NOTE: do NOT surface 13 POST — that is general service, not scam reporting.
  ],
  telstra: [
    {
      kind: "call",
      label: "Forward the scam SMS to Telstra",
      value: "7226",
      description: 'Free — forward a scam text to 7226 (spells "SCAM").',
      priority: 20,
    },
    // source: telstra.com.au/cyber-security-and-safety/scams
    {
      kind: "email",
      label: "Report Telstra-brand misuse",
      value: "abuse@telstra.com",
      description: "Report phishing that impersonates Telstra.",
      priority: 21,
    },
  ],
};

// Services-Australia sub-brands all route to the same helpdesk.
const SERVICES_AUSTRALIA_ALIASES = [
  "mygov",
  "my gov",
  "medicare",
  "centrelink",
  "child support",
];

/**
 * Map Claude's free-text `impersonatedBrand` to a BRAND_ROUTES key.
 * Returns null when the brand isn't one we have an official route for
 * (the resolver then falls back to the national best-link + Scamwatch).
 */
export function normaliseBrandKey(brand: string | null): string | null {
  if (!brand) return null;
  const b = brand.trim().toLowerCase();
  if (!b) return null;
  if (b.includes("ato") || b.includes("taxation") || b.includes("tax office"))
    return "ato";
  if (
    b.includes("services australia") ||
    SERVICES_AUSTRALIA_ALIASES.some((a) => b.includes(a))
  )
    return "services_australia";
  if (b.includes("australia post") || b.includes("auspost")) return "australia_post";
  if (b.includes("telstra")) return "telstra";
  return null;
}

// Optional "your state police" informational fallback — shown BELOW the
// national best-link, never as the primary (every state page just funnels to
// ReportCyber anyway). All URLs verified 2026-07-07.
export const STATE_POLICE_FALLBACK: Record<string, ReportingAction> = {
  NSW: { kind: "url", label: "NSW Police — Frauds & Scams", value: "https://www.police.nsw.gov.au/crime/frauds_and_scams", priority: 60 },
  VIC: { kind: "url", label: "Victoria Police — Report cybercrime & scams", value: "https://www.police.vic.gov.au/report-cybercrime-scams-online-abuse", priority: 60 },
  QLD: { kind: "url", label: "Queensland Police — Reporting cybercrime", value: "https://www.police.qld.gov.au/policelink-reporting/reporting-cybercrime", priority: 60 },
  SA: { kind: "url", label: "SA Police — Scams & cybercrime", value: "https://www.police.sa.gov.au/your-safety/scams-and-cybercrime", priority: 60 },
  WA: { kind: "url", label: "WA — Report cybercrime", value: "https://www.wa.gov.au/service/security/law-enforcement/report-cybercrime", priority: 60 },
  TAS: { kind: "url", label: "Tasmania Police — Scam information", value: "https://www.police.tas.gov.au/what-we-do/online-safety/scam-information/", priority: 60 },
  NT: { kind: "url", label: "CyberNT — Report an incident", value: "https://cyber.nt.gov.au/cyber-incidents/report-incident", priority: 60 },
  ACT: { kind: "url", label: "ACT Policing — Online safety", value: "https://police.act.gov.au/community-safety/online-safety", priority: 60 },
};
// sources: police.nsw.gov.au, police.vic.gov.au, police.qld.gov.au,
// police.sa.gov.au, wa.gov.au, police.tas.gov.au, cyber.nt.gov.au, police.act.gov.au

// Scam types that must route to eSafety with a safety-first tone rather than
// generic "analyse this scam" framing (NSW pilot brief §3 Tier 3). Matched as
// substrings against the lowercased scamType.
export const SENSITIVE_SCAM_TYPE_TOKENS = [
  "sextortion",
  "image-based",
  "image based",
  "intimate image",
  "revenge porn",
  "virtual kidnap",
];

export function isSensitiveScamType(scamType: string | null): boolean {
  if (!scamType) return false;
  const t = scamType.toLowerCase();
  return SENSITIVE_SCAM_TYPE_TOKENS.some((tok) => t.includes(tok));
}

// Active-threat scam types where a 000 urgent pin is warranted on HIGH_RISK.
export const ACTIVE_THREAT_SCAM_TYPE_TOKENS = [
  "remote access",
  "remote-access",
  "virtual kidnap",
  "sextortion",
  "in person",
  "in-person",
];

export function isActiveThreatScamType(scamType: string | null): boolean {
  if (!scamType) return false;
  const t = scamType.toLowerCase();
  return ACTIVE_THREAT_SCAM_TYPE_TOKENS.some((tok) => t.includes(tok));
}
