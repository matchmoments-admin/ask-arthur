import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logEvent } from "@/lib/analytics-events";

// Clone Watch lead magnet: a requester gives a work email + a brand and gets
// that brand's suspected-lookalike CSV emailed to them. The high-intent B2B
// capture (a bank/super fund seeing its own clone list is a warm SPF lead).
//
// SENSITIVITY: any work email can request ANY brand's list. Mitigations:
// server flag DARK by default (FF_CLONE_LIST_REQUEST), work-email gate,
// per-IP rate limit, tp_confirmed-only "suspected lookalikes for review"
// framing (never "fraudulent"), and the clone_watch_disputes correction
// process. Founder sign-off gates flipping the flag on.

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

  const company = d.company || d.email.split("@")[1] || "(unknown)";

  // Dedupe: same email + brand + clone_watch source. Skip re-insert but still
  // (re)send the export — a repeat request is a legitimate "resend my list".
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
      assessment_data: { brand: d.brand, consent: true, requested_list: true },
    });
    if (insErr) {
      logger.error("clone-list-request: lead insert failed", { error: insErr.message });
      // Non-fatal — still send the export.
    }
  }

  // First-party attribution — the lead-magnet download is a B2B conversion.
  void logEvent({
    eventType: "contact_submit",
    eventProps: { form: "clone_list", brand: d.brand },
    path: "/api/clone-list-request",
  });

  // Per-brand suspected-lookalike list — tp_confirmed only, public-safe fields.
  const { data: clones } = await supabase
    .from("shopfront_clone_alerts")
    .select("candidate_domain, first_seen_at, urlscan_classification")
    .eq("source", "nrd")
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .ilike("inferred_target_domain", `%${d.brand}%`)
    .order("first_seen_at", { ascending: false })
    .limit(500);

  const rows = (clones as CloneRow[] | null) ?? [];
  const csv = buildBrandCsv(d.brand, rows);

  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Ask Arthur Clone Watch <hello@askarthur.au>",
        to: d.email,
        subject: `Your Clone Watch list for ${d.brand}`,
        text:
          `Here is the current list of suspected lookalike domains we're tracking for ${d.brand} ` +
          `(${rows.length} entries). These are suspected lookalikes submitted for review — not ` +
          `adjudicated findings. If any listed domain is legitimately yours, reply and we'll ` +
          `correct it.\n\nMethodology: https://askarthur.au/clone-watch/method`,
        attachments: [
          {
            filename: `clone-watch-${d.brand.replace(/[^a-z0-9.-]/gi, "-")}.csv`,
            content: Buffer.from(csv).toString("base64"),
          },
        ],
      });
    } catch (err) {
      logger.error("clone-list-request: email send failed", { error: String(err) });
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
