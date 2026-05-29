/**
 * Helpers for the OnwardReportPicker / Summary UI: deep-link builders for
 * "skipped" destinations (Scamwatch, ReportCyber, IDCARE) where the user
 * has to act, and an evidence-block builder that prefills the clipboard
 * with everything they'll need to paste into the destination's form.
 */

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
export const IDCARE_URL = "https://www.idcare.org/";
export const IDCARE_PHONE = "1800 595 160";

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
