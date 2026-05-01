import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { sendWeeklyDigest, sendWeeklyIntelDigest } from "@/lib/resend";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getWeeklyRedditIntel } from "@/lib/reddit-intel-weekly";
import { buildWeeklyTweetDraft } from "@/lib/tweet-draft";

// When the redditIntelEmail flag is on we always send to brendan even if
// the email_subscribers table is empty — the digest is the operator's
// weekly read on what the classifier found, and a 0-subscriber site
// shouldn't suppress that signal. Once paid subscribers exist they're
// added to the recipient list automatically.
const OPERATOR_EMAIL = "brendan.milton1211@gmail.com";

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ message: "Database not configured" });
    }

    // ── Reddit Intel digest path (gated) ───────────────────────────────────
    if (featureFlags.redditIntelEmail) {
      const intel = await getWeeklyRedditIntel();
      if (!intel) {
        logger.info("weekly-email: redditIntelEmail flag on but no intel data yet");
        return NextResponse.json({
          message: "redditIntelEmail flag on but no daily summaries in window — skipping send",
        });
      }

      const { data: subs } = await supabase
        .from("email_subscribers")
        .select("email")
        .eq("is_active", true);
      const subscriberEmails = (subs ?? []).map((s) => s.email as string);
      const recipients = Array.from(new Set([OPERATOR_EMAIL, ...subscriberEmails]));

      const tweetDraft = buildWeeklyTweetDraft(intel);

      try {
        await sendWeeklyIntelDigest(recipients, {
          weekStart: intel.weekStart,
          weekEnd: intel.weekEnd,
          totalPostsClassified: intel.totalPostsClassified,
          leadNarrative: intel.latestLeadNarrative,
          emergingThemes: intel.emergingThemes,
          topBrands: intel.topBrands,
          topCategories: intel.topCategories,
          scamOfTheWeekQuote: intel.scamOfTheWeekQuote,
          tweetDraft,
          modelVersion: intel.modelVersion,
          promptVersion: intel.promptVersion,
        });
      } catch (err) {
        // Log the failure to cost_telemetry so it's queryable alongside
        // the Inngest function errors at feature='reddit-intel-error'.
        // Keep the original error in the response body so the cron's
        // failed-status visibility surfaces it immediately.
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        const errorStack =
          err instanceof Error ? (err.stack ?? "").slice(0, 2000) : "";
        logger.error("weekly-email: intel digest send failed", {
          error: errorMessage,
          recipients: recipients.length,
        });
        await supabase.from("cost_telemetry").insert({
          feature: "reddit-intel-error",
          provider: "diagnostic",
          operation: "weekly-email-send",
          units: 0,
          estimated_cost_usd: 0,
          metadata: {
            error_message: errorMessage,
            error_stack: errorStack,
            recipients_count: recipients.length,
            cohort_range: `${intel.weekStart} → ${intel.weekEnd}`,
            themes: intel.emergingThemes.length,
          },
        });
        return NextResponse.json(
          {
            error: "weekly_intel_send_failed",
            message: errorMessage,
            cohortRange: `${intel.weekStart} → ${intel.weekEnd}`,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: `Sent weekly intel digest to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`,
        cohortRange: `${intel.weekStart} → ${intel.weekEnd}`,
        themes: intel.emergingThemes.length,
      });
    }

    // ── Legacy verified-scams digest path ──────────────────────────────────
    const { data: subscribers } = await supabase
      .from("email_subscribers")
      .select("email")
      .eq("is_active", true);

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ message: "No subscribers" });
    }

    // Get this week's verified scams
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const { data: scams } = await supabase
      .from("verified_scams")
      .select("scam_type, summary, impersonated_brand, red_flags")
      .gte("created_at", oneWeekAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    if (!scams || scams.length === 0) {
      return NextResponse.json({ message: "No scams to report this week" });
    }

    // Get latest published blog post URL
    const { data: latestPost } = await supabase
      .from("blog_posts")
      .select("slug")
      .eq("published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .single();

    const blogUrl = latestPost
      ? `https://askarthur.au/blog/${latestPost.slug}`
      : undefined;

    // Build structured scam items for React Email template
    const structuredScams = scams.slice(0, 5).map((s) => ({
      brand: s.impersonated_brand || s.scam_type,
      summary: s.summary,
    }));

    // Generate HTML summary (fallback)
    const scamSummary = `
      <p style="color: #334155; font-size: 16px; line-height: 1.6;">
        Here are the top scams we detected this week:
      </p>
      <ul style="color: #334155; font-size: 16px; line-height: 1.8; padding-left: 20px;">
        ${scams
          .map(
            (s) =>
              `<li><strong>${escapeHtml(s.impersonated_brand || s.scam_type)}</strong>: ${escapeHtml(s.summary)}</li>`
          )
          .join("")}
      </ul>
      <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-top: 20px;">
        <strong>Stay safe:</strong> Never share personal info with unsolicited contacts,
        and always verify requests through official channels.
      </p>
    `;

    const emails = subscribers.map((s) => s.email);
    await sendWeeklyDigest(emails, scamSummary, structuredScams, blogUrl);

    return NextResponse.json({
      message: `Sent weekly digest to ${emails.length} subscribers`,
      blogUrl,
    });
  } catch (err) {
    logger.error("Weekly email cron error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to send weekly emails" },
      { status: 500 }
    );
  }
}
