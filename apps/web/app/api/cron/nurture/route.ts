import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { render } from "@react-email/components";
import SPFIntro from "@/emails/nurture/SPFIntro";
import ReasonableSteps from "@/emails/nurture/ReasonableSteps";
import CollectiveIntelligence from "@/emails/nurture/CollectiveIntelligence";
import CaseStudy from "@/emails/nurture/CaseStudy";
import TechnicalOverview from "@/emails/nurture/TechnicalOverview";
import Deadline from "@/emails/nurture/Deadline";

// Nurture email schedule: days after lead creation → email template
const NURTURE_SCHEDULE = [
  { step: 1, daysAfter: 0, subject: "The SPF Act is live. Is your organisation ready?", Template: SPFIntro },
  { step: 2, daysAfter: 3, subject: "What counts as 'reasonable steps' under the SPF Act?", Template: ReasonableSteps },
  { step: 3, daysAfter: 7, subject: "Why isolated scam prevention isn't enough", Template: CollectiveIntelligence },
  { step: 4, daysAfter: 12, subject: "How Australian organisations are preparing for SPF compliance", Template: CaseStudy },
  { step: 5, daysAfter: 18, subject: "Six API endpoints. Live in under a day.", Template: TechnicalOverview },
  { step: 6, daysAfter: 25, subject: "SPF sector codes take effect July 2026. Let's talk this week.", Template: Deadline },
];

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const token = authHeader?.replace("Bearer ", "");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Brendan Milton <brendan@askarthur.au>";

  if (!resendKey) {
    return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
  }

  // Fetch leads that need nurture emails
  // Only process leads not in terminal states (won/lost)
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, email, nurture_step, nurture_last_sent_at, created_at")
    .not("status", "in", '("won","lost")')
    .lt("nurture_step", 6)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !leads) {
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    const nextStep = lead.nurture_step + 1;
    const schedule = NURTURE_SCHEDULE.find((s) => s.step === nextStep);
    if (!schedule) {
      skipped++;
      continue;
    }

    // Check if enough time has passed since lead creation
    const createdAt = new Date(lead.created_at);
    const daysSinceCreation = Math.floor(
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceCreation < schedule.daysAfter) {
      skipped++;
      continue;
    }

    // Don't send more than one email per day per lead
    if (lead.nurture_last_sent_at) {
      const lastSent = new Date(lead.nurture_last_sent_at);
      const hoursSinceLastSend = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastSend < 20) {
        skipped++;
        continue;
      }
    }

    // Render and send the email
    const unsubscribeUrl = `https://askarthur.au/unsubscribe?email=${encodeURIComponent(lead.email)}`;
    const { Template } = schedule;
    const html = await render(Template({ name: lead.name, unsubscribeUrl }));

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [lead.email],
          subject: schedule.subject,
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });

      if (res.ok) {
        // Update nurture step
        await supabase
          .from("leads")
          .update({
            nurture_step: nextStep,
            nurture_last_sent_at: now.toISOString(),
          })
          .eq("id", lead.id);

        sent++;
      }
    } catch {
      // Log but don't fail the whole batch
      skipped++;
    }
  }

  return NextResponse.json({
    success: true,
    processed: leads.length,
    sent,
    skipped,
  });
}
