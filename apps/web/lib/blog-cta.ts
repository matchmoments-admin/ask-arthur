// Canonical CTA + internal-link block appended to every generated blog post.
//
// WHY: this closes the content -> conversion measurement loop. A blog reader
// who lands on /blog/<slug> gets a first-touch aa_attribution cookie
// (landing_path=/blog/<slug>); when they click one of these CTAs and go on to
// scan or contact, the conversion is attributed back to that post via the
// content_post_funnel view (v191). The CTAs drive the click; the first-touch
// cookie carries the attribution.
//
// RULES (deliberate):
//  - Internal links ONLY, and NO utm params. UTMs on internal navigation would
//    fight the first-touch model; per-post attribution comes from landing_path,
//    not from tagging internal links.
//  - Link only to ALWAYS-LIVE surfaces (the scan tool `/` and `/contact`). The
//    /clone-watch pillar is gated OFF until the public pillar + method pages
//    ship and their copy is legal-vetted (#371) — flip INCLUDE_PILLAR_LINK then.

// Stable marker (the CTA heading) used for idempotency — never inject twice.
export const BLOG_CTA_MARKER = "## Check something suspicious in seconds";

// Flip to true once /clone-watch (+ /clone-watch/method) are public & vetted.
const INCLUDE_PILLAR_LINK = false;

/**
 * Append the canonical CTA/internal-link block to a generated markdown post.
 * Idempotent: if the block is already present, the input is returned unchanged.
 */
export function appendBlogCtaBlock(markdown: string): string {
  if (markdown.includes(BLOG_CTA_MARKER)) return markdown;

  const pillar = INCLUDE_PILLAR_LINK
    ? "\nSee how scammers clone Australian brands in [Ask Arthur Clone Watch](/clone-watch).\n"
    : "";

  return `${markdown.trimEnd()}
${pillar}
---

${BLOG_CTA_MARKER}

Not sure whether a message, link or phone number is legitimate? Paste it into Ask Arthur for a free, instant AI check — no signup, and nothing you paste is stored.

> [!TIP]
> **[Check a suspicious message, link or number — free →](/)**

Running scam-prevention for a bank, super fund, telco or digital platform? We help regulated businesses take the "reasonable steps" the Scams Prevention Framework expects. **[Talk to our team →](/contact)**
`;
}
