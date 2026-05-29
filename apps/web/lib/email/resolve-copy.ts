import { Marked } from "marked";
import { createServiceClient } from "@askarthur/supabase/server";
import { EMAIL_TEMPLATES } from "./copy-registry";

// Sync markdown renderer (no async highlighter, unlike lib/blogRenderer). Used
// inside React Email templates, which render synchronously.
const md = new Marked({ async: false, gfm: true, breaks: true });

/**
 * Resolve a template's editable copy: code defaults from the registry, with
 * any admin overrides from `email_copy` merged on top. Returns RAW markdown
 * per slot (the template interpolates {{vars}} + sanitizes at render via
 * renderCopySlot). Falls back to defaults if the DB is unavailable.
 *
 * 60s in-process cache — sends are low-volume crons/Inngest; this avoids a
 * refetch per send within a run without risking stale copy for long.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; copy: Record<string, string> }>();

export async function resolveEmailCopy(
  templateKey: string,
): Promise<Record<string, string>> {
  const def = EMAIL_TEMPLATES[templateKey];
  const defaults: Record<string, string> = {};
  for (const [slot, s] of Object.entries(def?.slots ?? {})) {
    defaults[slot] = s.default;
  }

  const cached = cache.get(templateKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.copy;

  const sb = createServiceClient();
  if (!sb) return defaults; // graceful fallback — code defaults

  const { data, error } = await sb
    .from("email_copy")
    .select("slot_key, content_md")
    .eq("template_key", templateKey);

  const merged = { ...defaults };
  if (!error) {
    for (const row of data ?? []) {
      const slot = row.slot_key as string;
      // Only honour overrides for slots the registry still defines.
      if (slot in defaults) merged[slot] = row.content_md as string;
    }
  }
  cache.set(templateKey, { at: Date.now(), copy: merged });
  return merged;
}

/** Clear the resolve cache (used by the save route after an edit). */
export function clearEmailCopyCache(templateKey?: string): void {
  if (templateKey) cache.delete(templateKey);
  else cache.clear();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "b", "i", "a", "ul", "ol", "li",
  "h3", "h4", "blockquote", "code", "pre",
]);

/**
 * Markdown → email-safe HTML. Defence in depth:
 *  1. interpolate {{vars}} (values HTML-escaped),
 *  2. escape ALL raw HTML in the source so nothing pasted survives as markup
 *     (markdown syntax doesn't use <>&, so it still works),
 *  3. marked renders only its own (safe) tags from markdown syntax,
 *  4. drop any <a href> whose protocol isn't http/https/mailto,
 *  5. strip any tag not in the allowlist (belt-and-braces).
 * Exported for unit testing.
 */
export function renderCopySlot(
  source: string,
  vars: Record<string, string> = {},
): string {
  // 1. interpolate {{var}} with escaped values
  const interpolated = source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) =>
    escapeHtml(vars[key] ?? ""),
  );
  // 2. escape raw HTML in the (now interpolated) markdown source
  const escaped = escapeHtml(interpolated);
  // 3. markdown → html (sync)
  let html = md.parse(escaped) as string;
  // 4. neutralise non-http(s)/mailto hrefs (e.g. javascript:)
  html = html.replace(/href\s*=\s*"([^"]*)"/gi, (_m, url) => {
    return /^(https?:|mailto:)/i.test(url.trim()) ? `href="${url}"` : 'href="#"';
  });
  // 5. strip disallowed tags, keeping their inner text
  html = html.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (full, tag) =>
    ALLOWED_TAGS.has(String(tag).toLowerCase()) ? full : "",
  );
  html = html.trim();
  // 6. unwrap a single outer <p>…</p> so one-paragraph slots render inline
  //    (matching the original <Text> look); multi-paragraph slots keep theirs.
  const single = html.match(/^<p>([\s\S]*)<\/p>$/);
  if (single && !single[1].includes("<p")) return single[1];
  return html;
}
