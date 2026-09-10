import { z } from "zod";

// Public evidence links only. Never accept a source-supplied phishing URL.
export function safeEvidenceUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      ["askarthur.au", "scamwatch.gov.au", "www.scamwatch.gov.au", "cyber.gov.au", "www.cyber.gov.au", "asic.gov.au", "www.asic.gov.au", "moneysmart.gov.au"].includes(u.hostname);
  } catch { return false; }
}
const prose = (max: number) => z.string().trim().min(1).max(max);
export const Story = z.object({
  id: prose(100), title: prose(140), summary: prose(650), take: prose(500),
  tells: z.array(prose(200)).min(1).max(3), action: prose(350),
  sourceLabel: prose(100), sourceUrl: z.string().refine(safeEvidenceUrl),
  sourceDate: z.iso.datetime({ offset: true }), jurisdiction: prose(100),
});
export const IssueContent = z.object({
  subject: prose(160), preheader: prose(200),
  stories: z.array(Story).min(1).max(3),
}).superRefine((value, ctx) => {
  if (new Set(value.stories.map(s => s.id)).size !== value.stories.length)
    ctx.addIssue({ code: "custom", message: "Choose distinct stories" });
});
export type NewsletterContent = z.infer<typeof IssueContent>;
export type NewsletterStory = z.infer<typeof Story>;

/** One fixed UTC week, [Monday, following Monday). Preparation never labels a
 * reprocessed record as new and repeated cron runs share the same window. */
export function newsletterWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7);
  return { start: new Date(end.getTime() - 7 * 86400000).toISOString(), end: end.toISOString() };
}

/** Defang domain-like tokens throughout editorial prose, including plain text.
 * Explicit, allowlisted source links are rendered separately. */
export function safeProse(value: string): string {
  return value.replace(/https?:\/\//gi, "hxxps://")
    .replace(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.)([a-z]{2,})(?=\b)/gi,
      (match: string) => match.replace(/\./g, "[.]"));
}

export const EDITORIAL_PLACEHOLDERS = [
  "Read the regulator’s original alert and write a concise explanation before approving this issue.",
  "Add Arthur’s explanation of why this warning matters to readers.",
  "Add a specific recognition clue supported by the source.",
  "Add the safe next step recommended by the source.",
];

/** Evidence identity is fixed by preparation, not supplied by the editor. */
export function approvalProblems(content: NewsletterContent, candidates: NewsletterStory[]): string[] {
  const problems: string[] = [];
  for (const story of content.stories) {
    const original = candidates.find(c => c.id === story.id);
    if (!original || ["sourceUrl", "sourceDate", "sourceLabel", "jurisdiction"].some(key => story[key as keyof NewsletterStory] !== original[key as keyof NewsletterStory]))
      problems.push(`Source evidence changed: ${story.id}`);
    if (EDITORIAL_PLACEHOLDERS.some(text => JSON.stringify(story).includes(text)))
      problems.push(`Finish the editorial copy: ${story.id}`);
  }
  return problems;
}
