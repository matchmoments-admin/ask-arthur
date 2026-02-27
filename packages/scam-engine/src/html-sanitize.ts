/**
 * Strips HTML artifacts from email body text before AI analysis.
 *
 * Defense-in-depth: even though the extension uses `innerText`, hidden CSS
 * elements (display:none), HTML comments, style/script blocks, and data
 * attributes can leak through other entry points. This function removes
 * them server-side before content reaches Claude.
 */
export function stripEmailHtml(text: string): string {
  let cleaned = text;

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  // Remove <style> blocks and their contents
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove <script> blocks and their contents
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove elements with display:none or visibility:hidden inline styles
  // Matches self-closing and paired tags with these styles
  cleaned = cleaned.replace(
    /<[^>]+style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*(?:\/>|>[\s\S]*?<\/[^>]+>)/gi,
    ""
  );

  // Remove data-* attributes from remaining tags
  cleaned = cleaned.replace(/\s+data-[\w-]+\s*=\s*["'][^"']*["']/gi, "");

  // Strip remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace: multiple spaces/tabs to single space, multiple newlines to double
  cleaned = cleaned.replace(/[^\S\n]+/g, " ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();

  return cleaned;
}
