import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { logger } from "@askarthur/utils/logger";

// Node runtime: requireAdmin() reads cookies + verifies an HMAC with
// node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Blog slugs are kebab-case; constrain the input so an operator can't push an
// arbitrary path into revalidatePath. The value is only ever used to build
// `/blog/<slug>`, so this is defence-in-depth, not a trust boundary.
const BodySchema = z.object({
  slug: z
    .string()
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case")
    .optional(),
});

/**
 * Admin on-demand ISR flush for the blog.
 *
 * WHY: `/blog/[slug]` is `revalidate = 3600`, so a direct edit to a post row
 * (e.g. setting a category via SQL, fixing a typo in the DB) is invisible for
 * up to an hour. The Ghost webhook busts the cache for Ghost-driven changes;
 * this is the equivalent escape hatch for changes made outside that flow.
 *
 * POST { slug?: string }
 *   - with slug  → revalidates `/blog/<slug>` and the `/blog` index
 *   - without    → revalidates the `/blog` index only (list-level changes)
 *
 * Gated by requireAdmin (HMAC cookie or Supabase admin role) — same posture as
 * the other /api/admin/* operator routes.
 */
export async function POST(req: Request) {
  await requireAdmin();

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof Error ? err.message : "validation failed",
      },
      { status: 400 },
    );
  }

  const revalidated = ["/blog"];
  revalidatePath("/blog");
  if (parsed.slug) {
    revalidatePath(`/blog/${parsed.slug}`);
    revalidated.push(`/blog/${parsed.slug}`);
  }

  logger.info("admin_blog_revalidate", { paths: revalidated });
  return NextResponse.json({ ok: true, revalidated });
}
