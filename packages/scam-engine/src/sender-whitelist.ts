// Australian legitimate sender whitelist — known-good senders that should
// bias analysis toward SAFE when detected in the submitted content.
// These are NOT auto-safe — Claude still analyzes — but they boost confidence
// in SAFE verdicts and reduce false positives on legitimate government/bank comms.

export const AU_LEGITIMATE_SENDERS = new Set([
  // Government
  "ato.gov.au",
  "servicesaustralia.gov.au",
  "mygov.au",
  "my.gov.au",
  "humanservices.gov.au",
  "centrelink.gov.au",
  "medicare.gov.au",
  "ndis.gov.au",
  "homeaffairs.gov.au",
  "border.gov.au",
  "health.gov.au",
  "cyber.gov.au",
  "esafety.gov.au",
  "scamwatch.gov.au",
  "accc.gov.au",
  "abf.gov.au",
  "aec.gov.au",
  "asic.gov.au",

  // Major banks
  "commbank.com.au",
  "anz.com.au",
  "westpac.com.au",
  "nab.com.au",
  "macquarie.com.au",
  "ing.com.au",
  "bankwest.com.au",
  "suncorp.com.au",
  "bendigo.com.au",
  "boq.com.au",

  // Telcos
  "telstra.com.au",
  "telstra.com",
  "optus.com.au",
  "vodafone.com.au",
  "tpg.com.au",
  "iinet.net.au",

  // Utilities & services
  "auspost.com.au",
  "australiapost.com.au",
  "transurban.com",
  "linkt.com.au",
  "medicare.gov.au",

  // Major retailers
  "woolworths.com.au",
  "coles.com.au",
  "bunnings.com.au",
  "kmart.com.au",
  "bigw.com.au",
]);

/**
 * Check if submitted text contains references to known legitimate Australian senders.
 * Returns the matched sender domain if found, null otherwise.
 * This is used to add context to Claude's analysis, NOT to auto-whitelist.
 */
export function detectLegitimateAuSender(text: string): string | null {
  const lower = text.toLowerCase();
  for (const sender of AU_LEGITIMATE_SENDERS) {
    if (lower.includes(sender)) {
      return sender;
    }
  }
  return null;
}
