import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { sendWeeklyDigest } from "@/lib/resend";
import { logger } from "@/lib/logger";

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

    // Get active subscribers
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
              `<li><strong>${s.impersonated_brand || s.scam_type}</strong>: ${s.summary}</li>`
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
