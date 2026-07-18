import crypto from "crypto";
import { render } from "@react-email/components";
import { renderCopySlot } from "./resolve-copy";
import BrandOutreachPilot, {
  ASK_ARTHUR_ABN,
  ASK_ARTHUR_SENDER_NAME,
  ASK_ARTHUR_SENDER_ROLE,
  ASK_ARTHUR_SITE,
} from "@/emails/BrandOutreachPilot";
import { classLabel } from "@/lib/clone-watch/outcome-copy";
import type { OutreachCloneSample } from "./brand-outreach-clones";

// Brand reach-out / pilot outreach — the founder-composed, four-eyes cold email.
//
// The founder writes the body; this module renders it inside the styled
// BrandOutreachPilot template (navy header card + ABN footer, matching the
// Brand Stewardship report) and, when we hold data for the brand, attaches a
// compact live sample of the lookalike domains we've detected + reported for
// them in the last 30 days as proof.
//
// The body is treated as light markdown and passed through the same sanitising
// renderer the Email Studio uses (`renderCopySlot`): raw pasted HTML is escaped
// to inert text, only http(s)/mailto links survive, and only an allowlisted set
// of tags is kept. That keeps this admin-authored, externally-sent field from
// being an injection surface.

export {
  ASK_ARTHUR_ABN,
  ASK_ARTHUR_SENDER_NAME,
  ASK_ARTHUR_SENDER_ROLE,
  ASK_ARTHUR_SITE,
};

/**
 * Starter body for the clone-watch pilot offer. The brand-specific hook is
 * left as a `{{hook}}` placeholder for the founder to replace with a real,
 * researched opening line before sending — an un-edited hook is the tell of
 * a mass-merge, which is exactly what the four-eyes path exists to avoid.
 */
export const PILOT_TEMPLATE_BODY = `Hi {{hook}},

I'm Brendan, the founder of Ask Arthur — an Australian scam-detection service. One of the things we run is a clone-watch system that spots lookalike and phishing domains impersonating Australian brands, often within hours of the domain being registered.

I'd like to offer you a straightforward pilot:

- **A$300/month**, on a 3-month term
- **First month free**
- In return, a short named case study we can publish together if the results are useful to you

Over the pilot we'd monitor for domains impersonating your brand, flag the live phishing ones with evidence (screenshots, registration dates, hosting), and help you get them taken down.

If that's worth a conversation, I'm happy to send through a recent real example of what we've already caught for a brand like yours.

Best,
Brendan`;

/**
 * Build the text/plain twin of the outreach email. The founder's raw markdown
 * reads fine as plain text and guarantees a text/plain part exists (a cold B2B
 * email without one takes a spam-score hit). When a clone sample is present, a
 * short plain-text summary of it is appended so the text twin carries the same
 * proof the HTML shows.
 */
export function buildOutreachText(args: {
  brandName: string;
  bodyMarkdown: string;
  cloneSample?: OutreachCloneSample | null;
}): string {
  const { brandName, bodyMarkdown, cloneSample } = args;

  let dataBlock = "";
  if (cloneSample && cloneSample.total > 0 && cloneSample.rows.length > 0) {
    const lead =
      `In the last 30 days we detected ${cloneSample.total} lookalike ` +
      `domain${cloneSample.total === 1 ? "" : "s"} impersonating ${brandName}` +
      (cloneSample.reported > 0
        ? ` and reported ${cloneSample.reported} of them to a takedown vendor on your behalf.`
        : ".");
    const rows = cloneSample.rows.map((c) => {
      const tag = c.classification ? ` (${classLabel(c.classification)})` : "";
      return `- ${c.domain}${tag}`;
    });
    const more =
      cloneSample.total > cloneSample.rows.length
        ? [`(+ ${cloneSample.total - cloneSample.rows.length} more available on request)`]
        : [];
    dataBlock = [
      ``,
      `A sample of what we've already caught for ${brandName}:`,
      lead,
      ...rows,
      ...more,
    ].join("\n");
  }

  return `${bodyMarkdown.trim()}

--
${ASK_ARTHUR_SENDER_NAME}
${ASK_ARTHUR_SENDER_ROLE}
${ASK_ARTHUR_SITE}
${dataBlock}

Ask Arthur · ABN ${ASK_ARTHUR_ABN} · Sydney, Australia
Sent to ${brandName} as a one-off business enquiry. Reply STOP and I won't contact you again.`;
}

/**
 * Render the multipart (html + text) bodies for a founder outreach email.
 *
 * The `bodyMarkdown` is the founder's own prose (light markdown). The HTML twin
 * sanitises it via `renderCopySlot` and renders it inside the styled
 * BrandOutreachPilot template; the text twin ships the raw markdown plus a
 * plain-text clone summary. Async because React Email's `render` is async.
 */
export async function renderOutreachEmail(args: {
  brandName: string;
  bodyMarkdown: string;
  cloneSample?: OutreachCloneSample | null;
  stopUrl?: string;
}): Promise<{ html: string; text: string }> {
  const { brandName, bodyMarkdown, cloneSample, stopUrl } = args;

  const bodyHtml = renderCopySlot(bodyMarkdown, { brandName });

  const el = BrandOutreachPilot({
    brandName,
    bodyHtml,
    cloneSample: cloneSample ?? null,
    stopUrl,
  });
  const html = await render(el);
  const text = buildOutreachText({ brandName, bodyMarkdown, cloneSample });

  return { html, text };
}

/**
 * Stable idempotency key for a single outreach send. Keyed on recipient +
 * subject + calendar day (UTC) so an accidental double-submit of the same
 * email on the same day never sends twice, while a deliberate follow-up the
 * next day (or with a changed subject) is allowed through.
 */
export function outreachIdempotencyKey(
  to: string,
  subject: string,
  date: Date = new Date(),
): string {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const digest = crypto
    .createHash("sha256")
    .update(`${to.toLowerCase()}|${subject}|${day}`)
    .digest("hex")
    .slice(0, 32);
  return `brand-outreach:${digest}`;
}
