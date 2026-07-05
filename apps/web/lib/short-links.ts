// Branded short-link registry for the in-house /go/[slug] redirect. Each entry
// maps a clean slug (used in LinkedIn captions / first comments) to an internal
// destination plus the UTMs to stamp on it. The click is logged server-side at
// the redirect, so it survives referrer-stripping even if the visitor bounces
// before the landing page loads.
//
// Operator workflow: add ONE slug per placement per monthly push. Reuse the
// same `campaign` across a month's placements (carousel / first-comment /
// founder-reshare) and differentiate with `content`. Values are lowercase,
// hyphen-separated — see docs/ops (UTM governance).

export interface ShortLink {
  /** Internal destination path (must resolve to a real route). */
  dest: string;
  source: string; // utm_source, e.g. "linkedin"
  medium: string; // utm_medium, e.g. "social" (organic) | "paid-social" (ads)
  campaign: string; // utm_campaign, e.g. "hesta-super-2026-07"
  content?: string; // utm_content, e.g. "first-comment"
}

export const SHORT_LINKS: Record<string, ShortLink> = {
  // Evergreen
  check: { dest: "/", source: "linkedin", medium: "social", campaign: "evergreen-2026", content: "caption-link" },
  feed: { dest: "/scam-feed", source: "linkedin", medium: "social", campaign: "evergreen-2026", content: "caption-link" },
  contact: { dest: "/contact", source: "linkedin", medium: "social", campaign: "evergreen-2026", content: "first-comment" },

  // 2026-07 Clone Watch — superannuation push
  "check-super": { dest: "/", source: "linkedin", medium: "social", campaign: "hesta-super-2026-07", content: "first-comment" },
  "contact-super": { dest: "/contact", source: "linkedin", medium: "social", campaign: "hesta-super-2026-07", content: "first-comment" },

  // 2026-07 Clone Watch — lookalike-domain playbook
  "lookalike-playbook": { dest: "/clone-watch", source: "linkedin", medium: "social", campaign: "lookalike-playbook-2026-07", content: "first-comment" },
};
