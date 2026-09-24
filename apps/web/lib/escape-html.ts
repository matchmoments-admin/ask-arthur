/**
 * Escape a string for interpolation into HTML text or a double-quoted
 * attribute. The shared helper for hand-built email HTML; several older
 * senders still carry private copies of the same five replacements.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Make a user-supplied string safe for a single-line email header value:
 * control characters (including CR/LF) become spaces, runs of whitespace
 * collapse, and the result is capped at `max` characters.
 */
export function headerSafe(value: string, max = 80): string {
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
