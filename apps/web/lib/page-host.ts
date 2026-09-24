/**
 * Reduce a page URL to its origin (scheme + host) — the only part an evidence
 * record needs to say where an image was seen. Paths, query strings and
 * fragments can carry personal data (message thread ids, tokens), so they are
 * dropped both when a record is written and when an older record is shown.
 * Returns null for anything that doesn't parse as an http(s) URL.
 */
export function pageHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
