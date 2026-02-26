import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@askarthur/supabase/server";
import { getCategories } from "@/lib/blog";
import { requireAdmin, verifyAdminToken, COOKIE_NAME, MAX_AGE } from "@/lib/adminAuth";
import { cookies } from "next/headers";

export default async function AdminBlogPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  if (!supabase) {
    return <p className="p-8 text-gov-slate">Database not configured</p>;
  }

  const [{ data: posts }, categories] = await Promise.all([
    supabase
      .from("blog_posts")
      .select(
        "id, title, slug, status, category, category_slug, subtitle, is_featured, created_at, published_at"
      )
      .order("created_at", { ascending: false }),
    getCategories(),
  ]);

  async function logout() {
    "use server";
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/admin",
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

    // Set published_at when first published
    if (status === "published") {
      updateData.published_at = new Date().toISOString();
    }

    await sb.from("blog_posts").update(updateData).eq("id", postId);

    revalidatePath("/blog");
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
