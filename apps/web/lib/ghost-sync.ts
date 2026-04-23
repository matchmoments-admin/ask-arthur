import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@askarthur/utils/logger";

// One-way mirror from Ghost (blog.askarthur.au) → blog_posts in Supabase.
// Ghost owns drafting + newsletter delivery (via Mailgun); safeverify owns
// the public read experience at askarthur.au/blog/<slug>. This module is
// shared by the webhook handler and the one-time backfill script so the
// mapping logic stays in one place.

// Subset of Ghost's post payload we consume. Ghost's full schema is wider;
// we only type fields the mirror reads. Optional everywhere because Ghost
// omits unset fields rather than emitting null.
export interface GhostPost {
  id: string;
  uuid?: string;
  slug: string;
  title: string;
  status: "published" | "draft" | "scheduled";
  html?: string | null;
  plaintext?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  custom_excerpt?: string | null;
  excerpt?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_image?: string | null;
  reading_time?: number | null;
  published_at?: string | null;
  updated_at?: string | null;
  tags?: Array<{ slug?: string; name?: string }>;
  primary_tag?: { slug?: string; name?: string } | null;
  primary_author?: { name?: string } | null;
}

// Ghost wraps webhook payloads as { post: { current?, previous? } }.
// `current` is absent on post.deleted; `previous` is absent on post.added.
export interface GhostWebhookPayload {
  post?: {
    current?: GhostPost;
    previous?: GhostPost;
  };
}

// The row shape we write to blog_posts. Subset of the table — leaves
// columns that have no Ghost analogue (subtitle, product, is_featured,
// source_scam_ids) untouched on upsert.
export interface BlogPostsRow {
  ghost_post_id: string;
  ghost_uuid: string | null;
  ghost_synced_at: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string; // plaintext for search_vector + word count
  content_html: string | null; // pre-rendered HTML from Ghost
  author: string;
  tags: string[];
  category_slug: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  meta_image_url: string | null;
  seo_title: string | null;
  meta_description: string | null;
  reading_time_minutes: number | null;
  published_at: string | null;
  updated_at: string | null;
  status: "published" | "draft";
}

export type ParsedGhostEvent =
  | { kind: "upsert"; post: GhostPost; status: "published" | "draft" }
  | { kind: "delete"; ghost_post_id: string }
  | { kind: "ignore"; reason: string };

/**
 * Map a Ghost post to a blog_posts row. Pure function — no I/O. The status
 * is passed in rather than read from `post.status` so the caller can express
 * intent: a post.unpublished event ships current.status='draft', and we want
 * to mirror that as status='draft' to hide it without losing the content.
 */
export function mapGhostPostToRow(
  post: GhostPost,
  status: "published" | "draft"
): BlogPostsRow {
  const tagNames = (post.tags ?? [])
    .map((t) => t.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  return {
    ghost_post_id: post.id,
    ghost_uuid: post.uuid ?? null,
    ghost_synced_at: new Date().toISOString(),
    slug: post.slug,
    title: post.title,
    excerpt: post.custom_excerpt ?? post.excerpt ?? "",
    content: post.plaintext ?? "",
    content_html: post.html ?? null,
    author: post.primary_author?.name ?? "Ask Arthur",
    tags: tagNames,
    // Only populate category_slug if Ghost's primary_tag has a slug AND it
    // matches one of our blog_categories. Webhook handler validates against
    // the table; here we just pass through the candidate.
    category_slug: post.primary_tag?.slug ?? null,
    hero_image_url: post.feature_image ?? null,
    hero_image_alt: post.feature_image_alt ?? null,
    meta_image_url: post.og_image ?? null,
    seo_title: post.meta_title ?? null,
    meta_description: post.meta_description ?? null,
    reading_time_minutes: post.reading_time ?? null,
    published_at: post.published_at ?? null,
    updated_at: post.updated_at ?? null,
    status,
  };
}

/**
 * Decide what the webhook receiver should do with a Ghost payload.
 *
 * Ghost doesn't put the event name in the body — it's only in the URL path
 * or webhook config. So we infer from payload shape + status:
 *   - no `current`         → delete (post.deleted)
 *   - current.status=published → upsert as published
 *   - current.status=draft     → upsert as draft (covers post.unpublished;
 *                                also covers edits of a still-draft post,
 *                                which is what we want — keep the mirror in
 *                                sync even for drafts so a republish doesn't
 *                                reintroduce stale content)
 *   - current.status=scheduled → ignore (Ghost will fire post.published when
 *                                the scheduled time hits)
 */
export function parseGhostWebhookEvent(
  payload: GhostWebhookPayload
): ParsedGhostEvent {
  const current = payload.post?.current;
  const previous = payload.post?.previous;

  if (!current) {
    const id = previous?.id;
    if (!id) {
      return { kind: "ignore", reason: "no current or previous post id" };
    }
    return { kind: "delete", ghost_post_id: id };
  }

  if (current.status === "scheduled") {
    return { kind: "ignore", reason: "scheduled post — wait for publish" };
  }

  return {
    kind: "upsert",
    post: current,
    status: current.status === "published" ? "published" : "draft",
  };
}

/**
 * Verify Ghost's X-Ghost-Signature header. Format:
 *   "sha256=<hex>, t=<unix-ms>"
 * Signature is HMAC-SHA256(rawBody + ts) using the integration's webhook
 * secret. Returns false if the format is malformed, the timestamp is older
 * than `maxAgeMs`, or the digest doesn't match (timing-safe).
 */
export function verifyGhostSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  opts: { maxAgeMs?: number; nowMs?: number } = {}
): boolean {
  if (!signatureHeader || !secret) return false;

  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const nowMs = opts.nowMs ?? Date.now();

  // "sha256=<hex>, t=<ts>" — Ghost uses comma+space; tolerate either.
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let providedHex: string | undefined;
  let tsStr: string | undefined;
  for (const part of parts) {
    if (part.startsWith("sha256=")) providedHex = part.slice("sha256=".length);
    else if (part.startsWith("t=")) tsStr = part.slice("t=".length);
  }
  if (!providedHex || !tsStr) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts) > maxAgeMs) return false;

  const expectedHex = createHmac("sha256", secret)
    .update(rawBody + tsStr)
    .digest("hex");

  // timingSafeEqual throws on length mismatch — guard explicitly.
  if (providedHex.length !== expectedHex.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(providedHex, "hex"),
      Buffer.from(expectedHex, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Upsert a Ghost post into blog_posts. Idempotent on ghost_post_id.
 * Drops category_slug if it doesn't match an existing blog_categories row
 * (FK constraint would reject the write otherwise).
 */
export async function syncGhostPost(
  supabase: SupabaseClient,
  post: GhostPost,
  status: "published" | "draft"
): Promise<void> {
  const row = mapGhostPostToRow(post, status);

  if (row.category_slug) {
    const { data } = await supabase
      .from("blog_categories")
      .select("slug")
      .eq("slug", row.category_slug)
      .maybeSingle();
    if (!data) row.category_slug = null;
  }

  const { error } = await supabase
    .from("blog_posts")
    .upsert(row, { onConflict: "ghost_post_id" });

  if (error) {
    logger.error("Ghost mirror upsert failed", {
      ghost_post_id: row.ghost_post_id,
      slug: row.slug,
      error: String(error),
    });
    throw error;
  }
}

/**
 * Hard-delete a mirrored row when Ghost fires post.deleted. We tombstone via
 * deletion rather than a soft-delete column because there's nothing in
 * safeverify that needs to know "this used to exist" — the canonical record
 * lives in Ghost.
 */
export async function deleteGhostPost(
  supabase: SupabaseClient,
  ghostPostId: string
): Promise<void> {
  const { error } = await supabase
    .from("blog_posts")
    .delete()
    .eq("ghost_post_id", ghostPostId);

  if (error) {
    logger.error("Ghost mirror delete failed", {
      ghost_post_id: ghostPostId,
      error: String(error),
    });
    throw error;
  }
}
