import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { scrubPII } from "@askarthur/scam-engine/sanitize";
import { getCategories } from "@/lib/blog";
import { requireAdmin, verifyAdminToken, COOKIE_NAME } from "@/lib/adminAuth";
import { cookies } from "next/headers";

// "Further reading" curation (blog_external_links, v227). Everything defaults
// to nofollow per /blog/editorial-policy; origin records how the link arrived.
const externalLinkSchema = z.object({
  // blog_posts.id is bigint — arrives from the form as a numeric string
  postId: z.coerce.number().int().positive(),
  slug: z.string().min(1),
  url: z.string().url().max(2048).startsWith("https://"),
  title: z.string().min(1).max(300),
  sourceName: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  rel: z.enum(["nofollow", "sponsored"]),
  origin: z.enum(["editorial", "outreach", "partnership"]),
});

interface ExternalLinkRow {
  id: string;
  post_id: number;
  url: string;
  title: string;
  source_name: string;
  rel: string;
  origin: string;
  is_active: boolean;
}

export default async function AdminBlogPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  if (!supabase) {
    return <p className="p-8 text-gov-slate">Database not configured</p>;
  }

  const [{ data: posts }, categories, { data: linkRows }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select(
        "id, title, slug, status, category, category_slug, subtitle, is_featured, created_at, published_at"
      )
      .order("created_at", { ascending: false }),
    getCategories(),
    supabase
      .from("blog_external_links")
      .select("id, post_id, url, title, source_name, rel, origin, is_active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const linksByPost = new Map<number, ExternalLinkRow[]>();
  for (const row of (linkRows as ExternalLinkRow[] | null) || []) {
    const list = linksByPost.get(row.post_id) || [];
    list.push(row);
    linksByPost.set(row.post_id, list);
  }

  async function logout() {
    "use server";
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      // Must match the login route's path so the clear actually clears.
      path: "/",
      maxAge: 0,
    });
    redirect("/admin/login");
  }

  async function updatePost(formData: FormData) {
    "use server";

    // Validate admin cookie
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token || !verifyAdminToken(token)) return;

    const postId = formData.get("postId") as string;
    const status = formData.get("status") as string;
    const categorySlug = formData.get("category_slug") as string;
    const subtitle = formData.get("subtitle") as string;
    const isFeatured = formData.get("is_featured") === "on";

    const sb = createServiceClient();
    if (!sb) return;

    const updateData: Record<string, unknown> = {
      status,
      category_slug: categorySlug || null,
      subtitle: subtitle || null,
      is_featured: isFeatured,
      updated_at: new Date().toISOString(),
    };

    // Set published_at when first published; scrub PII as a safety net
    if (status === "published") {
      updateData.published_at = new Date().toISOString();
      const { data: post } = await sb
        .from("blog_posts")
        .select("content, title, excerpt")
        .eq("id", postId)
        .single();
      if (post) {
        updateData.content = scrubPII(post.content || "");
        updateData.title = scrubPII(post.title || "");
        updateData.excerpt = scrubPII(post.excerpt || "");
      }
    }

    await sb.from("blog_posts").update(updateData).eq("id", postId);

    revalidatePath("/blog");
    revalidatePath("/admin/blog");
  }

  async function addExternalLink(formData: FormData) {
    "use server";

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token || !verifyAdminToken(token)) return;

    const parsed = externalLinkSchema.safeParse({
      postId: formData.get("postId"),
      slug: formData.get("slug"),
      url: formData.get("url"),
      title: formData.get("title"),
      sourceName: formData.get("source_name"),
      description: (formData.get("description") as string) || undefined,
      rel: formData.get("rel"),
      origin: formData.get("origin"),
    });
    if (!parsed.success) return;

    const sb = createServiceClient();
    if (!sb) return;

    await sb.from("blog_external_links").upsert(
      {
        post_id: parsed.data.postId,
        url: parsed.data.url,
        title: parsed.data.title,
        source_name: parsed.data.sourceName,
        description: parsed.data.description || null,
        rel: parsed.data.rel,
        origin: parsed.data.origin,
        is_active: true,
      },
      { onConflict: "post_id,url" }
    );

    revalidatePath(`/blog/${parsed.data.slug}`);
    revalidatePath("/admin/blog");
  }

  async function toggleExternalLink(formData: FormData) {
    "use server";

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token || !verifyAdminToken(token)) return;

    const linkId = formData.get("linkId") as string;
    const slug = formData.get("slug") as string;
    const nextActive = formData.get("nextActive") === "true";
    if (!linkId) return;

    const sb = createServiceClient();
    if (!sb) return;

    await sb
      .from("blog_external_links")
      .update({ is_active: nextActive })
      .eq("id", linkId);

    if (slug) revalidatePath(`/blog/${slug}`);
    revalidatePath("/admin/blog");
  }

  async function deleteExternalLink(formData: FormData) {
    "use server";

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token || !verifyAdminToken(token)) return;

    const linkId = formData.get("linkId") as string;
    const slug = formData.get("slug") as string;
    if (!linkId) return;

    const sb = createServiceClient();
    if (!sb) return;

    await sb.from("blog_external_links").delete().eq("id", linkId);

    if (slug) revalidatePath(`/blog/${slug}`);
    revalidatePath("/admin/blog");
  }

  const statusColors: Record<string, { bg: string; text: string }> = {
    published: { bg: "bg-safe-bg", text: "text-safe-text" },
    draft: { bg: "bg-warn-bg", text: "text-warn-text" },
    archived: { bg: "bg-slate-100", text: "text-slate-500" },
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-5">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-deep-navy text-2xl font-bold">Blog Admin</h1>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-slate-400 hover:text-danger-text transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {(posts || []).map((post) => {
          const status = post.status || "draft";
          const colors = statusColors[status] || statusColors.draft;

          return (
            <div
              key={post.id}
              className="border border-border-light rounded-lg p-5"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-deep-navy font-bold text-base">
                    {post.title}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(post.created_at).toLocaleDateString("en-AU")}
                    {post.slug && ` — /blog/${post.slug}`}
                  </p>
                </div>
                <span
                  className={`${colors.bg} ${colors.text} text-xs font-semibold px-2.5 py-1 rounded-full shrink-0`}
                >
                  {status}
                </span>
              </div>

              <form action={updatePost} className="space-y-3">
                <input type="hidden" name="postId" value={post.id} />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Status */}
                  <div>
                    <label className="block text-xs font-medium text-gov-slate mb-1">
                      Status
                    </label>
                    <select
                      name="status"
                      defaultValue={status}
                      className="w-full text-sm border border-border-light rounded px-2.5 py-1.5 bg-white"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-medium text-gov-slate mb-1">
                      Category
                    </label>
                    <select
                      name="category_slug"
                      defaultValue={post.category_slug || ""}
                      className="w-full text-sm border border-border-light rounded px-2.5 py-1.5 bg-white"
                    >
                      <option value="">None</option>
                      {categories.map((cat) => (
                        <option key={cat.slug} value={cat.slug}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Featured */}
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-gov-slate">
                      <input
                        type="checkbox"
                        name="is_featured"
                        defaultChecked={post.is_featured || false}
                        className="rounded border-border-light"
                      />
                      Featured
                    </label>
                  </div>
                </div>

                {/* Subtitle */}
                <div>
                  <label className="block text-xs font-medium text-gov-slate mb-1">
                    Subtitle
                  </label>
                  <input
                    type="text"
                    name="subtitle"
                    defaultValue={post.subtitle || ""}
                    placeholder="Optional subtitle..."
                    className="w-full text-sm border border-border-light rounded px-2.5 py-1.5"
                  />
                </div>

                <button
                  type="submit"
                  className="px-4 py-1.5 text-sm font-medium bg-deep-navy text-white rounded hover:bg-navy transition-colors"
                >
                  Save changes
                </button>
              </form>

              {/* Further reading — curated external links for this post */}
              <details className="mt-4 pt-4 border-t border-border-light">
                <summary className="text-sm font-medium text-gov-slate cursor-pointer select-none">
                  External links ({(linksByPost.get(post.id) || []).length})
                </summary>

                <div className="mt-3 space-y-2">
                  {(linksByPost.get(post.id) || []).map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between gap-3 text-sm border border-border-light rounded px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p
                          className={`font-medium truncate ${link.is_active ? "text-deep-navy" : "text-slate-400 line-through"}`}
                        >
                          {link.title}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {link.source_name} · {link.rel} · {link.origin} ·{" "}
                          {link.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <form action={toggleExternalLink}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <input type="hidden" name="slug" value={post.slug || ""} />
                          <input
                            type="hidden"
                            name="nextActive"
                            value={String(!link.is_active)}
                          />
                          <button
                            type="submit"
                            className="text-xs text-gov-slate hover:text-action-teal"
                          >
                            {link.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        <form action={deleteExternalLink}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <input type="hidden" name="slug" value={post.slug || ""} />
                          <button
                            type="submit"
                            className="text-xs text-danger-text hover:underline"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}

                  <form action={addExternalLink} className="space-y-2 pt-2">
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="slug" value={post.slug || ""} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="url"
                        name="url"
                        required
                        placeholder="https://…"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        name="title"
                        required
                        placeholder="Article title"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        name="source_name"
                        required
                        placeholder="Source (e.g. Scamwatch)"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        name="description"
                        placeholder="One-line description (optional)"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5"
                      />
                      <select
                        name="rel"
                        defaultValue="nofollow"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5 bg-white"
                      >
                        <option value="nofollow">nofollow (default)</option>
                        <option value="sponsored">sponsored (paid only)</option>
                      </select>
                      <select
                        name="origin"
                        defaultValue="editorial"
                        className="text-sm border border-border-light rounded px-2.5 py-1.5 bg-white"
                      >
                        <option value="editorial">editorial</option>
                        <option value="outreach">outreach</option>
                        <option value="partnership">partnership</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-medium border border-deep-navy text-deep-navy rounded hover:bg-deep-navy hover:text-white transition-colors"
                    >
                      Add external link
                    </button>
                  </form>
                </div>
              </details>
            </div>
          );
        })}

        {(!posts || posts.length === 0) && (
          <div className="text-center py-12 text-slate-400">
            No blog posts yet
          </div>
        )}
      </div>
    </div>
  );
}
