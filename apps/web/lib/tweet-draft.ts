// Tweet draft generator for the weekly Reddit-intel digest.
//
// Produces a ≤280-char draft the user can paste into X / Bluesky / LinkedIn
// without any formatting baggage. Pure function — given the weekly intel
// payload, returns a single string. Consumed by the email template, which
// renders the draft inside a copy-friendly code block.
//
// Style guide:
//   * Plain text only, no emojis, no all-caps (CLAUDE.md project rule).
//   * Lead with a specific signal — top theme or top brand — so the post
//     reads as a "this week" snapshot rather than generic awareness.
//   * Always end with a link back to askarthur.au so the post earns its
//     place in someone's feed beyond the snippet.

import type { WeeklyRedditIntel } from "./reddit-intel-weekly";

const MAX_CHARS = 280;
const LINK = "askarthur.au";

/**
 * Build a draft. Falls back to a generic template when the input is sparse
 * (no themes, no brands) — but still returns SOMETHING postable so the
 * email never ships with a blank tweet box.
 */
export function buildWeeklyTweetDraft(intel: WeeklyRedditIntel): string {
  const lines: string[] = [];
  lines.push("This week in AU scam intelligence:");

  const topTheme = intel.emergingThemes[0];
  const topBrand = intel.topBrands[0];
  const topCategory = intel.topCategories[0];

  if (topTheme) {
    lines.push(`- ${truncate(topTheme.title, 80)} (${topTheme.memberCount} reports)`);
  }
  if (topBrand) {
    lines.push(`- ${truncate(topBrand.brand, 30)} impersonations: ${topBrand.mentionCount}`);
  }
  if (topCategory) {
    lines.push(`- top category: ${humaniseCategory(topCategory.label)}`);
  }
  lines.push(`- ${intel.totalPostsClassified} posts classified`);
  lines.push(`More: ${LINK}`);

  const draft = lines.join("\n");
  if (draft.length <= MAX_CHARS) return draft;

  // Over budget — drop lines from the bottom (keep header + first signal +
  // link), then truncate the first signal as a last resort.
  const head = `This week in AU scam intelligence:\n${lines[1] ?? ""}\nMore: ${LINK}`;
  if (head.length <= MAX_CHARS) return head;
  return truncate(head, MAX_CHARS - 1) + "…";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function humaniseCategory(label: string): string {
  // intent_label values are snake_case. Convert to "Title Case With Spaces"
  // for human consumption in the tweet, e.g. investment_fraud → Investment Fraud.
  return label
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
