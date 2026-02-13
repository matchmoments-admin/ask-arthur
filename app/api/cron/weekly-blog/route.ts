import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateWeeklyBlogPost } from "@/lib/blogGenerator";
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
    });

    if (error) {
      logger.error("Failed to insert blog post", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to insert blog post" },
        { status: 500 }
      );
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
