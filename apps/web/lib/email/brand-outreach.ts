import crypto from "crypto";
import { renderCopySlot } from "./resolve-copy";

// Brand reach-out / pilot outreach — the founder-composed, four-eyes cold email.
//
// This is deliberately NOT a marketing template: it renders as a plain,
// personal founder-to-brand note (no hero image, no big CTA button). The
// founder writes the body; this module only wraps it in a minimal, honest
// Ask Arthur signature so the email carries the legal-entity footer and a
// STOP path, and produces the text/plain twin a cold B2B email needs to
// avoid a spam-score hit.
//
// The body is treated as light markdown and passed through the same
// sanitising renderer the Email Studio uses (`renderCopySlot`): raw pasted
// HTML is escaped to inert text, only http(s)/mailto links survive, and only
// an allowlisted set of tags is kept. That keeps this admin-authored,
// externally-sent field from being an injection surface.

/** Legal-entity footer facts — single source of truth for the outreach signature. */
export const ASK_ARTHUR_ABN = "72 695 772 313";
export const ASK_ARTHUR_SENDER_NAME = "Brendan";
export const ASK_ARTHUR_SENDER_ROLE = "Founder, Ask Arthur";
export const ASK_ARTHUR_SITE = "https://askarthur.au";

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
 * Escape text for safe inclusion in HTML. Kept local so the module has no
 * dependency on the (non-exported) escapeHtml in resolve-copy.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the multipart (html + text) bodies for a founder outreach email.
 *
 * The `bodyMarkdown` is the founder's own prose (light markdown). The HTML
 * twin runs it through `renderCopySlot` (sanitising markdown → email HTML);
 * the text twin ships the raw markdown, which reads fine as plain text and
 * guarantees a text/plain part exists.
 */
export function buildOutreachEmail(args: {
  brandName: string;
  bodyMarkdown: string;
}): { html: string; text: string } {
  const { brandName, bodyMarkdown } = args;

  const bodyHtml = renderCopySlot(bodyMarkdown, { brandName });

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:560px;margin:0 auto;padding:24px 20px;">
    <div>${bodyHtml}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;" />
    <p style="margin:0 0 4px;font-size:14px;color:#1f2937;">
      ${escapeHtml(ASK_ARTHUR_SENDER_NAME)}<br />
      ${escapeHtml(ASK_ARTHUR_SENDER_ROLE)}<br />
      <a href="${ASK_ARTHUR_SITE}" style="color:#0d9488;text-decoration:none;">askarthur.au</a>
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
      Ask Arthur &middot; ABN ${ASK_ARTHUR_ABN} &middot; Sydney, Australia<br />
      Sent to ${escapeHtml(brandName)} as a one-off business enquiry. Reply STOP and I won't contact you again.
    </p>
  </div>
</body></html>`;

  const text = `${bodyMarkdown.trim()}

--
${ASK_ARTHUR_SENDER_NAME}
${ASK_ARTHUR_SENDER_ROLE}
${ASK_ARTHUR_SITE}

Ask Arthur · ABN ${ASK_ARTHUR_ABN} · Sydney, Australia
Sent to ${brandName} as a one-off business enquiry. Reply STOP and I won't contact you again.`;

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
