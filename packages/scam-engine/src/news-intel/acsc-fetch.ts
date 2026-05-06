// ACSC RSS fetch + parse — runs in Vercel runtime, not GH Actions, because
// Akamai tarpits Azure (GH) IPs but accepts Vercel's egress (untested but
// plausible — confirm via the first cron run after flipping the flag).
//
// No XML library: the ACSC RSS schema is small (item / title / link /
// description / pubDate / category) and well-formed, so a regex pass is
// enough. Avoids adding fast-xml-parser as a dependency for one source.

const ITEM_RE = /<item>([\s\S]*?)<\/item>/g;

function stripCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractFirst(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1])).trim();
}

function extractAll(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = decodeEntities(stripCdata(m[1])).trim();
    if (v) out.push(v);
  }
  return out;
}

export interface AcscRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  categories: string[];
}

export function parseAcscRss(xml: string): AcscRssItem[] {
  const items: AcscRssItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = ITEM_RE.exec(xml)) !== null) {
    const block = m[1];
    const title = extractFirst(block, "title");
    const link = extractFirst(block, "link");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      description: extractFirst(block, "description") ?? "",
      pubDate: extractFirst(block, "pubDate"),
      categories: extractAll(block, "category"),
    });
  }
  return items;
}

export interface AcscFetchResult {
  ok: boolean;
  status: number;
  items: AcscRssItem[];
  error?: string;
}

export async function fetchAcscFeed(
  url: string,
  timeoutMs = 20_000,
): Promise<AcscFetchResult> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(timeoutMs),
      // Defensive: skip Vercel/CDN caching to avoid stale RSS.
      cache: "no-store",
    });
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        items: [],
        error: `HTTP ${resp.status}`,
      };
    }
    const xml = await resp.text();
    return { ok: true, status: resp.status, items: parseAcscRss(xml) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      items: [],
      error: message.slice(0, 240),
    };
  }
}

// ── Mapping AcscRssItem → feed_items row shape (matches the Python
// scraper's bulk_upsert_narrative_feed_items input so rows are idempotent
// across both runners during the rollout phase). ──

import { createHash } from "node:crypto";

export interface FeedItemRow {
  source: "acsc";
  external_id: string;
  title: string;
  description: string | null;
  body_md: string | null;
  url: string;
  source_url: string;
  category: string;
  country_code: "AU";
  tags: string[];
  published_at: string | null;
  source_created_at: string | null;
  provenance_tier: "tier_1_regulator";
  published: true;
}

function inferCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  if (/(phish|fake email|fake sms)/.test(text)) return "phishing";
  if (/(ransom|malware|trojan)/.test(text)) return "other";
  if (/(scam|fraud|impersonat)/.test(text)) return "impersonation";
  return "informational";
}

export function toFeedItemRow(item: AcscRssItem, kind: string): FeedItemRow {
  const externalId = createHash("sha256")
    .update(item.link)
    .digest("hex")
    .slice(0, 32);
  const description = item.description.slice(0, 2000) || null;
  return {
    source: "acsc",
    external_id: externalId,
    title: item.title,
    description,
    body_md: item.description || null,
    url: item.link,
    source_url: item.link,
    category: inferCategory(item.title, item.description),
    country_code: "AU",
    tags: [...item.categories, kind],
    published_at: item.pubDate,
    source_created_at: item.pubDate,
    provenance_tier: "tier_1_regulator",
    published: true,
  };
}
