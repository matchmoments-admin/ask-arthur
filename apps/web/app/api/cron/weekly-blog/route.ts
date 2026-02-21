import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@askarthur/supabase/server";
import { generateWeeklyBlogPost } from "@/lib/blogGenerator";
import { logger } from "@/lib/logger";

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

    const post = await generateWeeklyBlogPost();

    if (!post) {
      return NextResponse.json({
        message: "No scam data available to generate blog post",
      });
    }

    // Insert with published: false (manual review before publish)
    const { error } = await supabase.from("blog_posts").insert({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      tags: post.tags,
      author: "Arthur AI",
      published: false,
      published_at: new Date().toISOString(),
      source_scam_ids: post.sourceScamIds,
    });

    if (error) {
      logger.error("Failed to insert blog post", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to insert blog post" },
        { status: 500 }
      );
    }

    // Notify admin that a new post needs review (fire-and-forget)
    if (process.env.ADMIN_EMAIL && process.env.RESEND_API_KEY) {
      const adminUrl = process.env.ADMIN_SECRET
        ? `https://askarthur.au/admin/blog?secret=${process.env.ADMIN_SECRET}`
        : "https://askarthur.au/admin/blog";

      const resend = new Resend(process.env.RESEND_API_KEY);
      resend.emails
        .send({
          from: process.env.RESEND_FROM_EMAIL || "Ask Arthur <alerts@askarthur.au>",
          to: process.env.ADMIN_EMAIL,
          subject: `New blog post needs review: ${post.title}`,
          html: `<p>A new blog post has been generated and needs review:</p>
<p><strong>${escapeHtml(post.title)}</strong></p>
<p><a href="${escapeHtml(adminUrl)}">Review in admin panel</a></p>`,
        })
        .catch((err) => logger.error("Failed to send admin notification", { error: String(err) }));
    }

    return NextResponse.json({
      message: "Blog post generated successfully",
      title: post.title,
      slug: post.slug,
      published: false,
    });
  } catch (err) {
    logger.error("Weekly blog cron error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to generate blog post" },
      { status: 500 }
    );
  }
}
