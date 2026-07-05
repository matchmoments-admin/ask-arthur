import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { CreateLeadInputSchema } from "@askarthur/types";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { logEvent } from "@/lib/analytics-events";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  createFeedbackPage,
  type FeedbackPayload,
  type FeedbackType,
} from "@/lib/notion/feedback-tracker";

// Where new-lead notifications are delivered. Kept a const so the
// recipient is obvious in code review — don't silently redirect this to
// a shared inbox without discussing with the founder.
const LEAD_NOTIFY_EMAIL = "brendan@askarthur.au";

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

    // First-party attribution — the B2B lead is the revenue KPI. Metadata
    // only: no name / email / company. `form` distinguishes a general (B2B /
    // partner) enquiry from typed product feedback. No-ops without a cookie.
    const leadFeedbackType =
      (lead.assessment_data as { feedback_type?: string } | null)
        ?.feedback_type ?? null;
    void logEvent({
      eventType: "contact_submit",
      eventProps: {
        source: lead.source ?? "website",
        form: leadFeedbackType === "general" ? "partner" : "contact",
        ...(lead.sector ? { sector: lead.sector } : {}),
        ...(leadFeedbackType ? { feedback_type: leadFeedbackType } : {}),
      },
      path: "/contact",
    });

    // Fire-and-forget notifications. The Supabase insert above is the
    // durable source of truth; any of these three channels failing must
    // NOT 500 the response to the user. Wrapped individually so one
    // provider outage doesn't block the others.
    const challenge = (lead.assessment_data as { challenge?: string } | null)?.challenge ?? "";

    // Slack (existing)
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

    // Email to Brendan via Resend. Uses the same RESEND_API_KEY +
    // RESEND_FROM_EMAIL env pair used by the welcome + weekly-digest
    // paths in apps/web/lib/resend.ts. Keeps the copy short — it's a
    // heads-up, not a pitch.
    if (process.env.RESEND_API_KEY) {
      (async () => {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const from = process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <brendan@askarthur.au>";
          await resend.emails.send({
            from,
            to: LEAD_NOTIFY_EMAIL,
            replyTo: lead.email,
            subject: `New lead: ${lead.name} — ${lead.company_name}`,
            html: buildLeadEmailHtml(lead, challenge),
          });
          logCost({
            feature: "email",
            provider: "resend",
            operation: "lead_notification",
            units: 1,
            unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
            metadata: { sector: lead.sector ?? null, source: lead.source ?? "website" },
          });
        } catch (err) {
          logger.error("Lead email notification failed", { error: String(err) });
        }
      })();
    }

    // Determine if this submission is typed feedback (bug/improvement/feature)
    // — those route to Notion + a structured Telegram alert. General enquiries
    // use the existing /agent-fleet lead format.
    const ax = (lead.assessment_data ?? {}) as Record<string, unknown>;
    const feedbackType = (ax.feedback_type as FeedbackType | "general" | undefined) ?? "general";
    const isTypedFeedback =
      feedbackType === "bug" ||
      feedbackType === "improvement" ||
      feedbackType === "feature";

    // Notion dual-write — only fires for typed feedback. Non-blocking.
    let notionPageUrl: string | null = null;
    if (isTypedFeedback) {
      try {
        const payload: FeedbackPayload = {
          type: feedbackType,
          title: String(ax.title ?? "").slice(0, 200),
          description: String(ax.description ?? ""),
          reporterEmail: lead.email,
          reporterName: lead.name,
          stepsToReproduce: typeof ax.steps === "string" ? ax.steps : null,
          severity: ax.severity as FeedbackPayload["severity"],
          currentBehavior: typeof ax.current === "string" ? ax.current : null,
          desiredBehavior: typeof ax.desired === "string" ? ax.desired : null,
          problem: typeof ax.problem === "string" ? ax.problem : null,
          useCase: typeof ax.use_case === "string" ? ax.use_case : null,
          url: typeof ax.url === "string" ? ax.url : null,
          userAgent: typeof ax.user_agent === "string" ? ax.user_agent : null,
          appVersion: typeof ax.app_version === "string" ? ax.app_version : null,
          source: "web",
        };
        const page = await createFeedbackPage(payload);
        notionPageUrl = page?.url ?? null;
      } catch (err) {
        logger.error("Notion feedback write failed", { error: String(err) });
      }
    }

    // Telegram ping. Two formats:
    //  - General lead: existing /agent-fleet lead style.
    //  - Typed feedback: structured HTML alert with Notion deep-link.
    (async () => {
      try {
        if (isTypedFeedback) {
          await sendAdminTelegramMessage(
            buildFeedbackTelegram(
              feedbackType,
              ax,
              lead.name,
              lead.email,
              lead.company_name,
              notionPageUrl
            )
          );
        } else {
          const hearAbout =
            (lead.assessment_data as { hear_about?: string } | null)?.hear_about ?? null;
          const lines = [
            `/agent-fleet lead`,
            `<b>New lead</b> — ${escapeHtml(lead.name)} (${escapeHtml(lead.email)})`,
            `Company: ${escapeHtml(lead.company_name)}${lead.sector ? ` · ${escapeHtml(lead.sector)}` : ""}`,
            lead.source ? `Source: ${escapeHtml(lead.source)}` : null,
            hearAbout ? `Heard via: ${escapeHtml(hearAbout)}` : null,
            challenge ? `\n<i>${escapeHtml(truncate(challenge, 400))}</i>` : null,
          ].filter(Boolean);
          await sendAdminTelegramMessage(lines.join("\n"));
        }
      } catch (err) {
        logger.error("Lead Telegram notification failed", { error: String(err) });
      }
    })();

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

// ----------------------------------------------------------------------

type LeadInput = ReturnType<typeof CreateLeadInputSchema.parse>;

function buildLeadEmailHtml(lead: LeadInput, challenge: string): string {
  const row = (label: string, value: string | null | undefined) =>
    value ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;">${label}</td><td style="padding:4px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>` : "";
  return `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; color: #0F172A; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 18px; margin-bottom: 4px;">New lead from the contact form</h1>
    <p style="color: #64748b; margin-top: 0; font-size: 12px;">Reply directly — the reply-to is set to ${escapeHtml(lead.email)}.</p>
    <table style="border-collapse: collapse; margin-top: 16px; font-size: 14px;">
      ${row("Name", lead.name)}
      ${row("Email", lead.email)}
      ${row("Company", lead.company_name)}
      ${row("Sector", lead.sector ?? null)}
      ${row("Phone", lead.phone ?? null)}
      ${row("Source", lead.source ?? "website")}
    </table>
    ${challenge ? `<div style="margin-top:18px;padding:12px;background:#f8fafc;border-radius:8px;font-size:14px;line-height:1.5;"><strong style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Challenge</strong><br/>${escapeHtml(challenge)}</div>` : ""}
    <p style="margin-top: 24px; color:#94a3b8; font-size: 12px;">Stored in Supabase <code>leads</code> table. Also posted to <code>/agent-fleet lead</code> in Telegram ops.</p>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const FEEDBACK_EMOJI: Record<FeedbackType, string> = {
  bug: "🐛",
  improvement: "🛠",
  feature: "✨",
};

function buildFeedbackTelegram(
  type: FeedbackType,
  ax: Record<string, unknown>,
  reporter: string,
  email: string,
  company: string,
  notionUrl: string | null
): string {
  const title = String(ax.title ?? "").slice(0, 200);
  const description = String(ax.description ?? "");
  const severity = ax.severity ? `[${String(ax.severity)}]` : "";
  const url = typeof ax.url === "string" ? ax.url : "";

  const lines = [
    `/agent-fleet feedback`,
    `${FEEDBACK_EMOJI[type]} <b>New ${type}${severity ? " " + escapeHtml(severity) : ""}</b>`,
    `<b>${escapeHtml(title)}</b>`,
    "",
    escapeHtml(truncate(description, 600)),
    "",
    `👤 ${escapeHtml(reporter)} &lt;${escapeHtml(email)}&gt;`,
    `🏢 ${escapeHtml(company)}`,
  ];
  if (url) lines.push(`🔗 <a href="${escapeHtml(url)}">Page</a>`);
  if (notionUrl) lines.push(`\n📝 <a href="${escapeHtml(notionUrl)}">Open in Notion</a>`);
  return lines.join("\n");
}
