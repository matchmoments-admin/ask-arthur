import { html, isSafeHref, joinHtml, safeHref, type HtmlValue, type SafeHtml } from "@askarthur/utils/html";
import type { FeedbackType } from "@/lib/notion/feedback-tracker";

// Admin Telegram alert for a typed feedback submission (bug / improvement /
// feature). Every field is user-submitted form data: escaped by `html`, and
// the page URL only becomes a link when it is http(s)/mailto.

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const FEEDBACK_EMOJI: Record<FeedbackType, string> = {
  bug: "🐛",
  improvement: "🛠",
  feature: "✨",
};

export function buildFeedbackTelegram(
  type: FeedbackType,
  ax: Record<string, unknown>,
  reporter: string,
  email: string,
  company: string,
  notionUrl: string | null
): SafeHtml {
  const title = String(ax.title ?? "").slice(0, 200);
  const description = String(ax.description ?? "");
  const severity = ax.severity ? `[${String(ax.severity)}]` : "";
  const url = typeof ax.url === "string" ? ax.url : "";

  const lines: HtmlValue[] = [
    html`/agent-fleet feedback`,
    html`${FEEDBACK_EMOJI[type]} <b>New ${type}${severity ? " " + severity : ""}</b>`,
    html`<b>${title}</b>`,
    "",
    truncate(description, 600),
    "",
    html`👤 ${reporter} &lt;${email}&gt;`,
    html`🏢 ${company}`,
  ];
  // `url` is user-submitted: only http(s)/mailto become links.
  if (url) lines.push(html`🔗 ${safeHref(url, "Page")}${isSafeHref(url) ? "" : html` (${url})`}`);
  if (notionUrl) lines.push(html`\n📝 ${safeHref(notionUrl, "Open in Notion")}`);
  return joinHtml(lines, "\n");
}
