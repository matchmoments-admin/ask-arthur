import { NextRequest, NextResponse } from "next/server";
import { CreateLeadInputSchema } from "@askarthur/types";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const rateCheck = await checkFormRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = CreateLeadInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const lead = parsed.data;

    const supabase = createServiceClient();
    if (!supabase) {
      logger.error("Supabase service client unavailable for lead creation");
      return NextResponse.json(
        { error: "Service temporarily unavailable." },
        { status: 503 }
      );
    }

    const { error: insertError } = await supabase.from("leads").insert({
      name: lead.name,
      email: lead.email,
      company_name: lead.company_name,
      abn: lead.abn ?? null,
      sector: lead.sector ?? null,
      role_title: lead.role_title ?? null,
      phone: lead.phone ?? null,
      source: lead.source ?? "website",
      utm_source: lead.utm_source ?? null,
      utm_medium: lead.utm_medium ?? null,
      utm_campaign: lead.utm_campaign ?? null,
      assessment_data: lead.assessment_data ?? null,
    });

    if (insertError) {
      logger.error("Lead insert failed", { error: String(insertError) });
      return NextResponse.json(
        { error: "Failed to submit. Please try again." },
        { status: 500 }
      );
    }

    if (process.env.SLACK_WEBHOOK_LEADS_URL) {
      fetch(process.env.SLACK_WEBHOOK_LEADS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `New lead: *${lead.name}* (${lead.email}) from ${lead.company_name}${lead.sector ? ` — ${lead.sector}` : ""}${lead.source ? ` via ${lead.source}` : ""}`,
        }),
      }).catch((err) =>
        logger.error("Slack lead notification failed", { error: String(err) })
      );
    }

    return NextResponse.json(
      {
        success: true,
        message:
          "Thank you for your interest. We'll be in touch within 24 hours.",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
