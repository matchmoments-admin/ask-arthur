/**
 * AskArthur intel-inbound-email Worker.
 *
 * Receives email from Cloudflare Email Routing, parses the MIME, extracts
 * source attribution from the recipient tag, resolves GovDelivery wrapper
 * redirects, and POSTs a structured payload to the intel-inbound-email
 * Supabase Edge Function.
 *
 * Address-tagging contract:
 *   <slug>+ingest@intel.askarthur.au   →   source = "inbound_<slug>"
 * where <slug> ∈ {scamwatch, acsc, austrac, oaic, afp, acma, idcare,
 *                 auscert, ftc, riskybiz, krebs}. Anything else falls back
 *                 to "inbound_generic".
 *
 * Edge cases we deliberately handle:
 *   - Multiple To / Cc / X-Original-To headers — we pick the first one
 *     matching the +ingest@ pattern; otherwise inbound_generic.
 *   - Missing/duplicate Message-ID — hash subject+from+date as fallback.
 *   - HTML-only emails (no text/plain part) — strip tags with a minimal
 *     regex; full HTML→text fidelity isn't worth a dep for this volume.
 *   - GovDelivery / Mailgun / SendGrid tracking wrappers — resolve via a
 *     bounded HEAD chain (max 3 redirects, 5s total) so the body stored in
 *     feed_items has real destination URLs.
 */

import PostalMime from "postal-mime";

interface Env {
  INBOUND_EMAIL_WEBHOOK_SECRET: string;
  SUPABASE_EDGE_FUNCTION_URL: string; // e.g. https://<ref>.functions.supabase.co/intel-inbound-email
  /** Optional. URL of the user-scan endpoint (e.g.
   *  https://askarthur.au/api/inbound-scan). When the recipient tag is
   *  `scan_report`, the worker dispatches to this URL instead of the
   *  intel newsletter Edge Function so user-forwarded scam reports are
   *  analysed and replied to rather than written to feed_items. */
  SCAN_REPORT_ENDPOINT_URL?: string;
  QUARANTINE_FORWARDER?: SendEmail; // optional; routes parse failures to ops@
}

// ── Source-attribution table ────────────────────────────────────────────

const KNOWN_TAGS = [
  // Original v128 set (PR-A3):
  "scamwatch",
  "acsc",
  "austrac",
  "oaic",
  "afp",
  "acma",
  "idcare",
  "auscert",
  "ftc",
  "riskybiz",
  "krebs",
  // v129 additions (PR-A3 extension — replaces sources without email path):
  "ato",
  "sans",
  "tldr_infosec",
  "thn",
  "securityweek",
  // User-scan tag (F1 — scan@askarthur-inbound.com → /api/inbound-scan).
  // Differs from the others: messages are NOT written to feed_items;
  // they're forwarded to a different endpoint that analyses + replies.
  "scan_report",
] as const;
type KnownTag = (typeof KNOWN_TAGS)[number];

/** True when this source should be routed to the user-scan endpoint
 *  instead of the intel-inbound newsletter Edge Function. */
function isUserScanSource(source: string): boolean {
  return source === "inbound_scan_report";
}

function resolveSource(addresses: string[]): string {
  for (const addr of addresses) {
    const local = addr.split("@")[0]?.toLowerCase() ?? "";
    // pattern: <tag>+ingest  (or just <tag> if no plus-tag suffix)
    const tagCandidate = local.split("+")[0] ?? "";
    if ((KNOWN_TAGS as readonly string[]).includes(tagCandidate)) {
      return `inbound_${tagCandidate as KnownTag}`;
    }
  }
  return "inbound_generic";
}

// ── Body extraction ─────────────────────────────────────────────────────

// Exported for unit tests in index.test.ts (#237 + #238 regression fixes).
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // #238: preserve <a href> URLs as "label (url)" so newsletters whose
    // confirm CTAs are button-only (TLDR, SANS, THN, SecurityWeek) don't
    // lose the href when the generic tag-strip below runs. Anchor labels
    // may wrap nested tags (<span>, <strong>); inner tags are stripped
    // here so the label reads cleanly in the resulting text.
    .replace(
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, url, label) => `${label.replace(/<[^>]+>/g, "")} (${url})`,
    )
    .replace(/<\/?(p|br|div|tr|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── GovDelivery / link-tracking redirect resolver ───────────────────────
//
// GovDelivery wraps every link as https://lnks.gd/l/eyJ... — HEAD-following
// once gives us the canonical destination. We do this for the *first* link
// found in the body and rewrite the body to point at the canonical URL,
// because that's the one the scam-engine needs to analyse downstream.
//
// Bounded: max 3 hops, max 5s wall-clock. If a redirect fails, leave the
// wrapper URL in place (Claude can still cope, and we don't want to leak
// failures into the storage path).

const TRACKING_HOSTS = [
  "lnks.gd",         // GovDelivery
  "click.email",     // generic Mailgun-style
  "trk.klclick.com", // Klaviyo
  "go.email",        // generic
  "url.us.m.mimecastprotect.com",
];

async function resolveTrackingUrl(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (!TRACKING_HOSTS.some((h) => parsed.hostname.endsWith(h))) return url;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    let current = url;
    for (let hop = 0; hop < 3; hop++) {
      const resp = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: ctl.signal,
      });
      const next = resp.headers.get("location");
      if (!next) break;
      current = new URL(next, current).toString();
      // If the next hop is no longer a tracking host we're done.
      try {
        const nh = new URL(current).hostname;
        if (!TRACKING_HOSTS.some((h) => nh.endsWith(h))) {
          clearTimeout(timer);
          return current;
        }
      } catch {
        break;
      }
    }
    clearTimeout(timer);
    return current;
  } catch {
    return url;
  }
}

// Exported for unit tests in index.test.ts.
// #237: the character class [^\s<>"']+ doesn't exclude trailing prose
// punctuation (`)`, `,`, `.`, `;`, `!`, `?`, `]`), so URLs wrapped in
// Markdown parens or ending a sentence get over-captured. Strip those
// after the match — none are valid as the *final* char of a URL anyway.
export function extractFirstUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m?.[0].replace(/[)\].,;!?]+$/, "");
}

// Exported for unit tests. 2026-05-17: THN (The Hacker News) inbound
// newsletters arrived with a 561-char text/plain part that was nothing
// but "This email is not formatted for viewing in a text email client.
// Please read it with an HTML friendly email client..." boilerplate.
// The real article content lived in text/html only. The previous body-
// extraction logic (`parsed.text ?? htmlToText(parsed.html)`) saw a
// non-empty text/plain and never reached the htmlToText fallback,
// shipping the boilerplate as the feed_item body.
//
// Heuristic: if the text/plain part looks like an HTML-display-only
// redirect notice, prefer the HTML body. Two signals must both hold:
//   (a) text is short (< 2000 chars — real digests are 4k–40k+)
//   (b) text matches a known "view in HTML email" pattern
// Either alone is too loose: short text can be a legitimate one-paragraph
// alert; the patterns alone could match a real article *quoting* a
// scammer's "view in HTML" lure.
export function isBoilerplatePlainText(text: string): boolean {
  if (text.length > 2000) return false;
  return (
    /not formatted for viewing in a\s*text email client/i.test(text) ||
    /please read.{0,40}(?:html.friendly|in.{0,20}html|as a web page)/i.test(text) ||
    /view (?:this )?email .{0,40}(?:as a web page|in.{0,20}browser|in.{0,20}html)/i.test(text)
  );
}

// ── Idempotency key ─────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function externalIdFor(
  messageId: string | undefined,
  from: string,
  subject: string,
  receivedAt: string,
): Promise<string> {
  if (messageId) {
    return (await sha256Hex(messageId)).slice(0, 32);
  }
  return (await sha256Hex(`${from}|${subject}|${receivedAt}`)).slice(0, 32);
}

// ── Email handler ───────────────────────────────────────────────────────

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    let parsed: Awaited<ReturnType<PostalMime["parse"]>>;
    try {
      const parser = new PostalMime();
      parsed = await parser.parse(message.raw as unknown as ReadableStream);
    } catch (err) {
      console.error("postal-mime parse failed", err);
      // Don't 'setReject' — bouncing an inbound email could disrupt the
      // upstream subscription. Drop silently; subscription delivery
      // failures show in Cloudflare Email Routing logs.
      if (env.QUARANTINE_FORWARDER) {
        await env.QUARANTINE_FORWARDER.send(message).catch(() => {});
      }
      return;
    }

    const toCandidates = [
      message.to,
      ...(parsed.to ?? []).map((a) => a.address ?? ""),
      ...(parsed.cc ?? []).map((a) => a.address ?? ""),
    ].filter(Boolean);
    const source = resolveSource(toCandidates);

    const subject = (parsed.subject ?? "(no subject)").trim().slice(0, 2000);
    const from = parsed.from?.address ?? message.from;
    const receivedAt = (parsed.date ?? new Date().toISOString()).toString();

    // Body: prefer text/plain unless it's just an "open me in an HTML
    // email client" boilerplate stub (THN does this). See
    // isBoilerplatePlainText() for the heuristic. Cap at 50KB to satisfy
    // the feed_items_body_md_size constraint.
    const plainBody = parsed.text ?? "";
    const htmlBody = parsed.html ?? "";
    let body: string;
    if (plainBody && !isBoilerplatePlainText(plainBody)) {
      body = plainBody;
    } else if (htmlBody) {
      body = htmlToText(htmlBody);
    } else {
      body = plainBody; // last resort — accept boilerplate if no HTML available
    }
    body = body.trim().slice(0, 50_000);

    // Resolve the first link if it's a tracking wrapper. We rewrite the
    // body so the canonical URL is what gets stored + later embedded.
    const firstUrl = extractFirstUrl(body);
    let canonicalUrl: string | undefined;
    if (firstUrl) {
      const resolved = await resolveTrackingUrl(firstUrl);
      canonicalUrl = resolved;
      if (resolved !== firstUrl) body = body.replace(firstUrl, resolved);
    }

    const messageId = parsed.messageId ?? message.headers.get("message-id") ?? undefined;
    const externalId = await externalIdFor(messageId, from, subject, receivedAt);

    const payload = {
      source,
      external_id: externalId,
      subject,
      body_md: body,
      url: canonicalUrl,
      from,
      to: toCandidates[0] ?? message.to,
      received_at: new Date(receivedAt).toISOString(),
      tags: undefined as string[] | undefined,
    };

    // User-scan tag (scan_report) routes to a different endpoint that
    // analyses the email + replies to the sender. Falls back to the intel
    // Edge Function only if SCAN_REPORT_ENDPOINT_URL isn't configured —
    // that's a "fail safe" choice: a misrouted user-scan ends up in
    // feed_items with source=inbound_scan_report, which the v128
    // feed_items_source_check constraint rejects (422). No data
    // corruption; operator gets a quarantine notice.
    const targetUrl =
      isUserScanSource(source) && env.SCAN_REPORT_ENDPOINT_URL
        ? env.SCAN_REPORT_ENDPOINT_URL
        : env.SUPABASE_EDGE_FUNCTION_URL;

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": env.INBOUND_EMAIL_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok && resp.status !== 204) {
      const text = await resp.text().catch(() => "");
      console.error("inbound-email forward failed", {
        status: resp.status,
        source,
        externalId,
        body: text.slice(0, 500),
      });
      // 4xx is a contract bug (we'd retry forever); 5xx is transient. The
      // Cloudflare Email Worker runtime doesn't redeliver on its own, so
      // there's no retry storm risk either way. Quarantine on 5xx so the
      // operator can replay manually.
      if (resp.status >= 500 && env.QUARANTINE_FORWARDER) {
        await env.QUARANTINE_FORWARDER.send(message).catch(() => {});
      }
    }
  },
} satisfies ExportedHandler<Env>;
