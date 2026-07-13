import crypto from "node:crypto";
import { logger } from "@askarthur/utils/logger";

/**
 * Minimal Ghost Admin API adapter — draft creation only.
 *
 * Ghost is the review/edit surface for generated posts (/admin/blog has no
 * content editor); publishing from Ghost flows back into blog_posts via the
 * existing ghost-webhook mirror and triggers Ghost's newsletter delivery.
 * Kept deliberately tiny and interface-shaped so a future Beehiiv adapter is
 * a drop-in swap — the caller only knows "create a draft, get a review URL".
 *
 * Auth: Ghost Admin API keys are `id:hexsecret`; requests carry a short-lived
 * HS256 JWT (kid=id, aud=/admin/). Hand-rolled with node:crypto to avoid a
 * jsonwebtoken dependency for one 20-line token.
 */

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url");

export function ghostAdminToken(adminApiKey: string): string | null {
  const [id, secret] = adminApiKey.split(":");
  if (!id || !secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const payload = b64url(
    JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })
  );
  const signature = crypto
    .createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export interface GhostDraftInput {
  title: string;
  html: string;
  excerpt?: string;
  tags?: string[];
}

export interface GhostDraftResult {
  postId: string;
  /** Ghost editor deep-link — the review URL for the admin. */
  editorUrl: string;
}

export async function createGhostDraft(
  input: GhostDraftInput
): Promise<GhostDraftResult | null> {
  const apiUrl = process.env["GHOST_API_URL"]?.trim().replace(/\/+$/, "");
  const adminKey = process.env["GHOST_ADMIN_API_KEY"]?.trim();
  if (!apiUrl || !adminKey) return null;

  const token = ghostAdminToken(adminKey);
  if (!token) {
    logger.error("ghost-admin: malformed GHOST_ADMIN_API_KEY (expected id:secret)");
    return null;
  }

  try {
    const res = await fetch(`${apiUrl}/ghost/api/admin/posts/?source=html`, {
      method: "POST",
      headers: {
        Authorization: `Ghost ${token}`,
        "Content-Type": "application/json",
        "Accept-Version": "v5.0",
      },
      body: JSON.stringify({
        posts: [
          {
            title: input.title,
            html: input.html,
            custom_excerpt: input.excerpt?.slice(0, 300),
            tags: input.tags?.map((name) => ({ name })),
            status: "draft",
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.error("ghost-admin: draft creation failed", {
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return null;
    }

    const json = (await res.json()) as { posts?: Array<{ id?: string }> };
    const postId = json.posts?.[0]?.id;
    if (!postId) return null;

    return { postId, editorUrl: `${apiUrl}/ghost/#/editor/post/${postId}` };
  } catch (err) {
    logger.error("ghost-admin: draft creation threw", { error: String(err) });
    return null;
  }
}
