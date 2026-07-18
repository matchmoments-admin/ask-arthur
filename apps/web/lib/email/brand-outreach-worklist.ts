// "Next brand to email" worklist — shared types + pure presenters.
//
// The ranking + candidate resolution lives in the SQL RPC
// get_brand_outreach_worklist() (migration v241). This module only shapes the
// rows for the UI: a one-line signal summary, a generated pitch "hook", and a
// ready-to-send composer body. Keeping these pure makes them unit-testable and
// shareable between the API route and the client panel.

export interface WorklistRow {
  brand_key: string;
  brand_name: string;
  weaponised_count: number;
  live_unactioned_count: number;
  total_clones: number;
  in_campaign: boolean;
  campaign_domain_count: number | null;
  latest_weaponised_at: string | null;
  has_contact: boolean;
  contact_recipient: string | null;
  contact_channel: string | null;
  contacted_recently: boolean;
  last_contacted_at: string | null;
  likely_enterprise: boolean;
}

/**
 * One-line signal summary, e.g.
 *   "3 weaponised · 14 live · part of a 28-domain campaign".
 * Only non-zero signals are shown; always ends with the total-clone count so a
 * quiet brand still reads sensibly.
 */
export function signalSummary(row: WorklistRow): string {
  const parts: string[] = [];
  if (row.weaponised_count > 0) parts.push(`${row.weaponised_count} weaponised`);
  if (row.live_unactioned_count > 0) parts.push(`${row.live_unactioned_count} live`);
  if (row.in_campaign) {
    parts.push(
      row.campaign_domain_count && row.campaign_domain_count > 1
        ? `part of a ${row.campaign_domain_count}-domain campaign`
        : "part of a coordinated campaign",
    );
  }
  parts.push(`${row.total_clones} lookalike${row.total_clones === 1 ? "" : "s"} total`);
  return parts.join(" · ");
}

/**
 * The generated pitch sentence for the email body. Leads with campaign
 * coordination when the brand is caught in a multi-domain campaign, else with
 * weaponisation urgency, else a plain lookalike-volume line.
 */
export function buildHookLine(row: WorklistRow): string {
  const brand = row.brand_name;
  if (row.in_campaign) {
    const size =
      row.campaign_domain_count && row.campaign_domain_count > 1
        ? `${row.campaign_domain_count} lookalike domains`
        : "a set of lookalike domains";
    return `I'm reaching out because we're tracking a coordinated campaign of ${size} — several of them registered to impersonate ${brand}, which is why I wanted to get this in front of your team quickly.`;
  }
  if (row.weaponised_count > 0) {
    const n = row.weaponised_count;
    return `We've picked up ${n} live phishing site${n === 1 ? "" : "s"} impersonating ${brand} in our clone-watch feed — I can send the evidence (screenshots, registration dates, hosting) straight over.`;
  }
  const total = row.total_clones;
  return `We're currently tracking ${total} lookalike domain${total === 1 ? "" : "s"} registered against ${brand}, and I wanted to flag them before any go live.`;
}

/**
 * A ready-to-edit composer body for a worklist brand: keeps the `{{hook}}`
 * greeting token (so the founder still names a real person) and drops the
 * generated pitch line in as the opening paragraph. Mirrors the PILOT_TEMPLATE
 * structure/offer, so a founder recognises it.
 */
export function buildComposerBody(row: WorklistRow): string {
  return `Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service that runs a clone-watch system spotting lookalike and phishing domains impersonating Australian brands, often within hours of registration.

${buildHookLine(row)}

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for ${row.brand_name}.

Best,
Brendan`;
}

/** Split the ranked list into the three UI buckets (order preserved). */
export function bucketWorklist(rows: WorklistRow[]): {
  eligible: WorklistRow[];
  contacted: WorklistRow[];
  enterprise: WorklistRow[];
} {
  const eligible: WorklistRow[] = [];
  const contacted: WorklistRow[] = [];
  const enterprise: WorklistRow[] = [];
  for (const r of rows) {
    if (r.contacted_recently) contacted.push(r);
    else if (r.likely_enterprise) enterprise.push(r);
    else eligible.push(r);
  }
  return { eligible, contacted, enterprise };
}
