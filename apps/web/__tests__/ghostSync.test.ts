import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  mapGhostPostToRow,
  parseGhostWebhookEvent,
  verifyGhostSignature,
  type GhostPost,
} from "@/lib/ghost-sync";

const fixturePost: GhostPost = {
  id: "5f7e8fb1abcd1234",
  uuid: "11111111-2222-3333-4444-555555555555",
  slug: "spotting-bank-impersonation",
  title: "Spotting Bank Impersonation in 2026",
  status: "published",
  html: "<p>Hello world.</p>",
  plaintext: "Hello world.",
  feature_image: "https://blog.askarthur.au/content/images/2026/04/hero.png",
  feature_image_alt: "Arthur reading a phishing SMS",
  custom_excerpt: "What to look for when a 'bank' SMS lands.",
  meta_title: "Bank impersonation SMS scams — Ask Arthur",
  meta_description: "How to spot fake bank SMS in 2026.",
  og_image: "https://blog.askarthur.au/content/images/2026/04/og.png",
  reading_time: 4,
  published_at: "2026-04-22T08:00:00.000Z",
  updated_at: "2026-04-22T08:05:00.000Z",
  tags: [{ slug: "scams", name: "Scams" }, { slug: "sms", name: "SMS" }],
  primary_tag: { slug: "scams", name: "Scams" },
  primary_author: { name: "Ask Arthur Team" },
};

describe("mapGhostPostToRow", () => {
  it("maps Ghost fields onto blog_posts columns", () => {
    const row = mapGhostPostToRow(fixturePost, "published");

    expect(row.ghost_post_id).toBe(fixturePost.id);
    expect(row.ghost_uuid).toBe(fixturePost.uuid);
    expect(row.slug).toBe(fixturePost.slug);
    expect(row.title).toBe(fixturePost.title);
    expect(row.excerpt).toBe(fixturePost.custom_excerpt);
    expect(row.content).toBe(fixturePost.plaintext);
    expect(row.content_html).toBe(fixturePost.html);
    expect(row.author).toBe("Ask Arthur Team");
    expect(row.tags).toEqual(["Scams", "SMS"]);
    expect(row.category_slug).toBe("scams");
    expect(row.hero_image_url).toBe(fixturePost.feature_image);
    expect(row.hero_image_alt).toBe(fixturePost.feature_image_alt);
    expect(row.meta_image_url).toBe(fixturePost.og_image);
    expect(row.seo_title).toBe(fixturePost.meta_title);
    expect(row.meta_description).toBe(fixturePost.meta_description);
    expect(row.reading_time_minutes).toBe(4);
    expect(row.published_at).toBe(fixturePost.published_at);
    expect(row.status).toBe("published");
    expect(typeof row.ghost_synced_at).toBe("string");
  });

  it("falls back to excerpt when custom_excerpt is missing", () => {
    const row = mapGhostPostToRow(
      { ...fixturePost, custom_excerpt: null, excerpt: "Auto excerpt." },
      "published"
    );
    expect(row.excerpt).toBe("Auto excerpt.");
  });

  it("falls back to a default author when primary_author is absent", () => {
    const row = mapGhostPostToRow(
      { ...fixturePost, primary_author: null },
      "published"
    );
    expect(row.author).toBe("Ask Arthur");
  });

  it("propagates draft status (used for post.unpublished events)", () => {
    const row = mapGhostPostToRow(fixturePost, "draft");
    expect(row.status).toBe("draft");
  });

  it("returns empty tags array when Ghost sends none", () => {
    const row = mapGhostPostToRow({ ...fixturePost, tags: [] }, "published");
    expect(row.tags).toEqual([]);
  });
});

describe("parseGhostWebhookEvent", () => {
  it("treats published current as upsert/published", () => {
    const event = parseGhostWebhookEvent({ post: { current: fixturePost } });
    expect(event.kind).toBe("upsert");
    if (event.kind === "upsert") {
      expect(event.status).toBe("published");
      expect(event.post.id).toBe(fixturePost.id);
    }
  });

  it("treats draft current as upsert/draft (covers post.unpublished)", () => {
    const event = parseGhostWebhookEvent({
      post: {
        current: { ...fixturePost, status: "draft" },
        previous: fixturePost,
      },
    });
    expect(event.kind).toBe("upsert");
    if (event.kind === "upsert") {
      expect(event.status).toBe("draft");
    }
  });

  it("treats absent current as delete using previous.id", () => {
    const event = parseGhostWebhookEvent({
      post: { previous: fixturePost },
    });
    expect(event.kind).toBe("delete");
    if (event.kind === "delete") {
      expect(event.ghost_post_id).toBe(fixturePost.id);
    }
  });

  it("ignores scheduled posts (waits for the publish event)", () => {
    const event = parseGhostWebhookEvent({
      post: { current: { ...fixturePost, status: "scheduled" } },
    });
    expect(event.kind).toBe("ignore");
  });

  it("ignores payloads with neither current nor previous id", () => {
    const event = parseGhostWebhookEvent({ post: {} });
    expect(event.kind).toBe("ignore");
  });
});

describe("verifyGhostSignature", () => {
  const secret = "test-secret-key";
  const body = JSON.stringify({ post: { current: fixturePost } });
  const ts = String(Date.now());

  function sign(rawBody: string, timestamp: string, key: string): string {
    return createHmac("sha256", key)
      .update(rawBody + timestamp)
      .digest("hex");
  }

  it("accepts a valid signature with a fresh timestamp", () => {
    const sig = sign(body, ts, secret);
    const header = `sha256=${sig}, t=${ts}`;
    expect(verifyGhostSignature(body, header, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body, ts, secret);
    const header = `sha256=${sig}, t=${ts}`;
    expect(verifyGhostSignature(body + "junk", header, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = sign(body, ts, "other-secret");
    const header = `sha256=${sig}, t=${ts}`;
    expect(verifyGhostSignature(body, header, secret)).toBe(false);
  });

  it("rejects timestamps older than 5 minutes (replay protection)", () => {
    const oldTs = String(Date.now() - 10 * 60 * 1000);
    const sig = sign(body, oldTs, secret);
    const header = `sha256=${sig}, t=${oldTs}`;
    expect(verifyGhostSignature(body, header, secret)).toBe(false);
  });

  it("rejects malformed headers", () => {
    expect(verifyGhostSignature(body, "garbage", secret)).toBe(false);
    expect(verifyGhostSignature(body, null, secret)).toBe(false);
    expect(verifyGhostSignature(body, `t=${ts}`, secret)).toBe(false);
  });

  it("rejects when secret is empty", () => {
    const sig = sign(body, ts, secret);
    const header = `sha256=${sig}, t=${ts}`;
    expect(verifyGhostSignature(body, header, "")).toBe(false);
  });
});
