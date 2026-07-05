import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import SPFIntro from "@/emails/nurture/SPFIntro";
import ReasonableSteps from "@/emails/nurture/ReasonableSteps";
import CollectiveIntelligence from "@/emails/nurture/CollectiveIntelligence";
import CaseStudy from "@/emails/nurture/CaseStudy";
import TechnicalOverview from "@/emails/nurture/TechnicalOverview";
import Deadline from "@/emails/nurture/Deadline";
import { sendNurtureEmail } from "@/lib/resend";
import { signUnsubscribeUrl } from "@/lib/unsubscribe";

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
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
  }

  // Fetch leads that need nurture emails
  // Only process leads not in terminal states (won/lost). clone_watch leads
  // are EXCLUDED: this is the SPF-compliance drip, and a brand that asked "show
  // me my clones" shouldn't get a 6-step compliance sequence (reads as bait-
  // and-switch). Their touch is the clone-list email + booking CTA instead.
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, email, nurture_step, nurture_last_sent_at, created_at")
    .not("status", "in", '("won","lost")')
    .neq("source", "clone_watch")
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

    // Render + send via the centralised helper, which handles signed
    // tokenised unsubscribe URLs, RFC 8058 one-click headers, and cost
    // telemetry. The signed URL also threads into the template body so
    // the in-email "Unsubscribe" link matches the header.
    const unsubscribeUrl = signUnsubscribeUrl(
      lead.email,
      "https://askarthur.au/unsubscribe",
    );
    const { Template } = schedule;
    const result = await sendNurtureEmail({
      email: lead.email,
      subject: schedule.subject,
      template: Template({ name: lead.name, unsubscribeUrl }),
      step: schedule.step,
    });

    if (result.ok) {
      await supabase
        .from("leads")
        .update({
          nurture_step: nextStep,
          nurture_last_sent_at: now.toISOString(),
        })
        .eq("id", lead.id);
      sent++;
    } else {
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
