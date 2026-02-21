import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";

interface PageProps {
  searchParams: Promise<{ secret?: string }>;
}

export default async function AdminBlogPage({ searchParams }: PageProps) {
  const { secret } = await searchParams;

  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    redirect("/");
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return <p>Database not configured</p>;
  }

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("id, title, slug, published, published_at, created_at")
    .order("created_at", { ascending: false });

  async function togglePublish(formData: FormData) {
    "use server";

    const adminSecret = formData.get("secret") as string;
    if (adminSecret !== process.env.ADMIN_SECRET) return;

    const postId = formData.get("postId") as string;
    const newPublished = formData.get("published") === "true";

    const sb = createServiceClient();
    if (!sb) return;

    await sb
      .from("blog_posts")
      .update({
        published: newPublished,
        published_at: newPublished ? new Date().toISOString() : null,
      })
      .eq("id", postId);

    revalidatePath("/blog");
    revalidatePath(`/admin/blog`);
  }

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Blog Admin</h1>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
            <th style={{ padding: "8px 12px" }}>Title</th>
            <th style={{ padding: "8px 12px" }}>Status</th>
            <th style={{ padding: "8px 12px" }}>Created</th>
            <th style={{ padding: "8px 12px" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {(posts || []).map((post) => (
            <tr key={post.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
              <td style={{ padding: "8px 12px" }}>{post.title}</td>
              <td style={{ padding: "8px 12px" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: post.published ? "#D1FAE5" : "#FEF3C7",
                    color: post.published ? "#065F46" : "#92400E",
                  }}
                >
                  {post.published ? "Published" : "Draft"}
                </span>
              </td>
              <td style={{ padding: "8px 12px", fontSize: 14, color: "#64748B" }}>
                {new Date(post.created_at).toLocaleDateString("en-AU")}
              </td>
              <td style={{ padding: "8px 12px" }}>
                <form action={togglePublish}>
                  <input type="hidden" name="secret" value={secret || ""} />
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="published" value={post.published ? "false" : "true"} />
                  <button
                    type="submit"
                    style={{
                      padding: "4px 12px",
                      borderRadius: 4,
                      border: "1px solid #CBD5E1",
                      backgroundColor: "#FFFFFF",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    {post.published ? "Unpublish" : "Publish"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {(!posts || posts.length === 0) && (
            <tr>
              <td colSpan={4} style={{ padding: "24px 12px", textAlign: "center", color: "#94A3B8" }}>
                No blog posts yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
