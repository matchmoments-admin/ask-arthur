// On-demand ISR flush for /blog/[slug] + the /blog index.
//
// RESTORED 2026-08-08 after being deleted in PR #948 as an "orphan with no
// UI caller". That judgement was wrong: the caller was never the admin UI —
// it is the OPERATOR (curl / a script), for exactly the case its original
// header described, "edits made outside the webhook — e.g. category_slug set
// via SQL". `/blog/[slug]` is `revalidate = 3600`, so a direct blog_posts
// edit (hero image, category, status) is invisible for up to an hour with no
// way to force it. That bit immediately: a hero set via PostgREST left the
// post rendering with no image and no lever to flush it.
//
// Auth: requireAdmin() (dual-mode — Supabase admin role or the HMAC cookie),
// same as every other /api/admin route, plus the middleware backstop.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { revalidateBlogPost } from "@/lib/blog";
import { logger } from "@askarthur/utils/logger";

// Slug omitted → index-only flush (list-level changes such as ordering or a
// post entering/leaving `published`).
const Body = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug expected")
    .optional(),
});

export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const { slug } = parsed.data;
  revalidateBlogPost(slug);
  logger.warn("blog_revalidated", { slug: slug ?? "(index only)" });

  return NextResponse.json({ ok: true, revalidated: slug ?? "index" });
}
