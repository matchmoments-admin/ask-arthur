import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logEvent } from "@/lib/analytics-events";
import { resolveWatchlistBrand } from "@/lib/clone-watch/resolve-brand";

// Human next step for every lead (booking-call-only funnel). A hosted booking
// page (Outlook "Bookings with me" / Google Calendar appointment schedule);
// falls back to /contact until NEXT_PUBLIC_BOOKING_URL is set.
const BOOKING_URL =
  process.env.NEXT_PUBLIC_BOOKING_URL || "https://askarthur.au/contact";

// Clone Watch lead magnet: a requester gives a work email + a brand and gets
// that brand's suspected-lookalike CSV emailed to them. The high-intent B2B
// capture (a bank/super fund seeing its own clone list is a warm SPF lead).
//
// SENSITIVITY: a request can only ever return ONE watch-listed brand's list —
// the input is resolved to a watch-list entry by EXACT set membership and the
// query matches that entry's own legitimate domains (exact IN), so no
// user-controlled wildcard can widen it (the old `.ilike('%'+brand+'%')` let
// `brand='%%'` exfiltrate every brand). Layered mitigations: server flag DARK
// by default (FF_CLONE_LIST_REQUEST), work-email gate, per-IP rate limit,
// tp_confirmed-only "suspected lookalikes for review" framing, and the
// clone_watch_disputes correction process. Founder sign-off gates the flag.

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  email: z.string().email().max(320).trim().toLowerCase(),
  brand: z.string().min(2).max(255).trim(),
  company: z.string().max(200).trim().optional(),
  consent: z.literal(true),
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
});

// Free-mail domains are rejected — this is a B2B capture; a personal address
// carries no company signal and defeats the ICP filter.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.au", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "proton.me",
  "protonmail.com", "aol.com", "gmx.com", "mail.com", "yandex.com",
  "bigpond.com", "optusnet.com.au",
]);

function isWorkEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && !FREE_MAIL.has(domain);
}

function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface CloneRow {
  candidate_domain: string;
  first_seen_at: string;
  urlscan_classification: string | null;
}

function buildBrandCsv(brand: string, rows: CloneRow[]): string {
  const header = ["candidate_domain", "first_seen", "classification"].join(",");
  const lines = rows.map((r) =>
    [
      csvEscape(r.candidate_domain),
      csvEscape(r.first_seen_at.slice(0, 10)),
      csvEscape(r.urlscan_classification ?? "unclassified"),
    ].join(","),
  );
  return [`# Suspected lookalike domains for ${brand} — submitted for review, not adjudicated findings.`, header, ...lines].join("\r\n") + "\r\n";
}

export async function POST(req: NextRequest) {
  // Dark by default until founder sign-off (see file header).
  if (!featureFlags.cloneListRequest) {
    return NextResponse.json({ error: "not_enabled" }, { status: 503 });
  }

  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = await checkFormRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const d = parsed.data;

  if (!isWorkEmail(d.email)) {
    return NextResponse.json({ error: "work_email_required" }, { status: 422 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Resolve the requested brand to a watch-list entry by EXACT set membership.
  // A non-resolving input (including SQL wildcards like "%%") is treated as an
  // UNMONITORED brand: still a captured lead (real demand signal), but no list.
  // This is what closes the cross-brand exfiltration — only a resolved brand's
  // OWN legitimate domains ever reach the query (exact IN, no wildcards).
  const entry = resolveWatchlistBrand(d.brand);
  const monitored = entry !== null;
  const company = d.company || d.email.split("@")[1] || "(unknown)";

  // Dedupe: same email + brand + clone_watch source. Skip re-insert but still
  // (re)send the email — a repeat request is a legitimate "resend my list".
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("email", d.email)
    .eq("source", "clone_watch")
    .eq("assessment_data->>brand", d.brand)
    .maybeSingle();

  if (!existing) {
    const { error: insErr } = await supabase.from("leads").insert({
      name: company,
      email: d.email,
      company_name: company,
      source: "clone_watch",
      utm_source: d.utm_source ?? null,
      utm_medium: d.utm_medium ?? null,
      utm_campaign: d.utm_campaign ?? null,
      assessment_data: {
        brand: d.brand,
        canonical_brand: entry?.brand ?? null,
        monitored,
        unmonitored_brand: !monitored,
        consent: true,
        requested_list: true,
      },
    });
    if (insErr) {
      logger.error("clone-list-request: lead insert failed", { error: insErr.message });
      // Non-fatal — still send the email.
    }
  }

  // First-party attribution — the lead-magnet request is a B2B conversion.
  void logEvent({
    eventType: "contact_submit",
    eventProps: { form: "clone_list", brand: entry?.brand ?? d.brand, monitored },
    path: "/api/clone-list-request",
  });

  // Never claim success when nothing could be delivered.
  if (!process.env.RESEND_API_KEY) {
    logger.error("clone-list-request: RESEND_API_KEY unset — cannot deliver");
    return NextResponse.json({ error: "delivery_unavailable" }, { status: 503 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Unmonitored brand → honest acknowledgement + booking CTA, no CSV.
  if (!entry) {
    try {
      await resend.emails.send({
        from: "Ask Arthur Clone Watch <hello@askarthur.au>",
        to: d.email,
        subject: `Clone Watch — ${d.brand}`,
        text:
          `Thanks for your interest. ${d.brand} isn't on our monitored brand list yet, so we ` +
          `don't have a lookalike-domain list to send today — but we've logged your request.\n\n` +
          `If you'd like us to start watching ${d.brand}, book a quick call: ${BOOKING_URL}\n\n` +
          `How we detect clones: https://askarthur.au/clone-watch/method`,
      });
    } catch (err) {
      logger.error("clone-list-request: unmonitored email failed", { error: String(err) });
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, monitored: false, count: 0 });
  }

  // Monitored brand → EXACT IN-match against its own legitimate domains only.
  const { data: clones } = await supabase
    .from("shopfront_clone_alerts")
    .select("candidate_domain, first_seen_at, urlscan_classification")
    .eq("source", "nrd")
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .in("inferred_target_domain", entry.legitimate_domains)
    .order("first_seen_at", { ascending: false })
    .limit(500);

  const rows = (clones as CloneRow[] | null) ?? [];
  const csv = buildBrandCsv(entry.brand, rows);

  try {
    await resend.emails.send({
      from: "Ask Arthur Clone Watch <hello@askarthur.au>",
      to: d.email,
      subject: `Your Clone Watch list for ${entry.brand}`,
      text:
        `Here is the current list of suspected lookalike domains we're tracking for ${entry.brand} ` +
        `(${rows.length} entries). These are suspected lookalikes submitted for review — not ` +
        `adjudicated findings. If any listed domain is legitimately yours, reply and we'll correct it.\n\n` +
        `Want us to walk you through it? Book a 15-min call: ${BOOKING_URL}\n\n` +
        `Methodology: https://askarthur.au/clone-watch/method`,
      attachments: [
        {
          filename: `clone-watch-${entry.brand.replace(/[^a-z0-9.-]/gi, "-")}.csv`,
          content: Buffer.from(csv).toString("base64"),
        },
      ],
    });
  } catch (err) {
    logger.error("clone-list-request: email send failed", { error: String(err) });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, monitored: true, count: rows.length });
}
