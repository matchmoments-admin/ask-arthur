// Supabase Edge Function: intel-inbound-email
//
// Receives parsed-email payloads from the Cloudflare Email Routing Worker
// (apps/cloudflare-email-worker) and writes them into feed_items so the
// existing feed-items-embed Inngest job picks them up like any narrative
// scraper row.
//
// Auth: shared-secret HMAC in X-Webhook-Secret header (set
// INBOUND_EMAIL_WEBHOOK_SECRET on both sides). The function itself uses
// the Supabase service-role key from its Edge Function env to write.
//
// Kill switch: ENABLE_INTEL_INBOUND_EMAIL=false → returns 204 (Worker
// treats this as "drop quietly").
//
// Idempotency: (source, external_id) is partial-unique on feed_items
// (idx_feed_items_external) — ON CONFLICT DO NOTHING short-circuits
// re-deliveries from Cloudflare retries.
//
// Deploy:
//   supabase functions deploy intel-inbound-email --project-ref rquomhcgnodxzkhokwni
//   supabase secrets set INBOUND_EMAIL_WEBHOOK_SECRET=...
//   supabase secrets set ENABLE_INTEL_INBOUND_EMAIL=true
//
// Local test:
//   supabase functions serve intel-inbound-email --env-file .env.local
//
// Runtime: Deno (Supabase Edge runtime). Imports use jsr: + npm: specifiers.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// ── Payload schema ──────────────────────────────────────────────────────

const InboundEmailPayload = z.object({
  // Pre-resolved source slug from the Worker. Must match the
  // feed_items_source_check allowlist (v128).
  source: z.enum([
    "inbound_scamwatch",
    "inbound_acsc",
    "inbound_austrac",
    "inbound_oaic",
    "inbound_afp",
    "inbound_acma",
    "inbound_idcare",
    "inbound_auscert",
    "inbound_ftc",
    "inbound_riskybiz",
    "inbound_krebs",
    "inbound_generic",
  ]),
  // Message-id hash from the Worker. Drives ON CONFLICT idempotency.
  external_id: z.string().min(8).max(128),
  subject: z.string().min(1).max(2000),
  // Plain-text body (HTML stripped, GovDelivery redirects resolved by
  // the Worker). 50 KB cap matches feed_items_body_md_size check.
  body_md: z.string().min(1).max(50_000),
  // Primary article URL if extracted by the Worker (first non-tracking
  // link in body). Optional — many newsletters have no canonical link.
  url: z.string().url().optional(),
  from: z.string().min(3).max(320),
  to: z.string().min(3).max(320),
  received_at: z.string().datetime(),
  // Optional source-supplied tags (RSS categories the Worker may have
  // pulled from the email headers).
  tags: z.array(z.string().max(64)).max(20).optional(),
});

type InboundEmailPayload = z.infer<typeof InboundEmailPayload>;

// ── Helpers ─────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Method check — Cloudflare Worker POSTs JSON.
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Kill switch. Worker treats 204 as "drop quietly", no retry.
  const enabled = Deno.env.get("ENABLE_INTEL_INBOUND_EMAIL");
  if (enabled !== "true") {
    return new Response(null, { status: 204 });
  }

  // Shared-secret auth. Reject early to keep the public endpoint cheap
  // under random scanner traffic.
  const expected = Deno.env.get("INBOUND_EMAIL_WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Body parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const parsed = InboundEmailPayload.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "validation_failed", issues: parsed.error.issues },
      422,
    );
  }
  const payload: InboundEmailPayload = parsed.data;

  // Write to feed_items. Service-role client; service-role env vars are
  // injected by Supabase Edge runtime.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("feed_items")
    .upsert(
      {
        source: payload.source,
        external_id: payload.external_id,
        title: payload.subject,
        description: null,
        body_md: payload.body_md,
        url: payload.url ?? null,
        source_url: payload.url ?? null,
        tags: payload.tags ?? null,
        published_at: payload.received_at,
        source_created_at: payload.received_at,
        country_code: "AU", // most subscriptions are AU gov; specific sources can override later
        provenance_tier: "verified", // gov subscriptions are first-party
      },
      { onConflict: "source,external_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: "db_write_failed", detail: error.message }, 500);
  }

  if (!data) {
    // ON CONFLICT short-circuit — duplicate, ignore.
    return jsonResponse({ status: "duplicate", source: payload.source }, 200);
  }

  return jsonResponse({ status: "stored", id: data.id, source: payload.source }, 200);
});
