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
  QUARANTINE_FORWARDER?: SendEmail; // optional; routes parse failures to ops@
}

// ── Source-attribution table ────────────────────────────────────────────

const KNOWN_TAGS = [
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
] as const;
type KnownTag = (typeof KNOWN_TAGS)[number];

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

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
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

function extractFirstUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m?.[0];
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

    // Body: prefer text/plain, fall back to HTML→text. Cap at 50KB to
    // satisfy the feed_items_body_md_size constraint.
    let body = parsed.text ?? "";
    if (!body && parsed.html) body = htmlToText(parsed.html);
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

    const resp = await fetch(env.SUPABASE_EDGE_FUNCTION_URL, {
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
