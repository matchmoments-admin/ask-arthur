// Social media publishing for brand impersonation alerts.
// Supports Twitter/X, LinkedIn, and Facebook.
// Each platform is optional — skipped if env vars not configured.

import { logger } from "@askarthur/utils/logger";
import crypto from "crypto";

interface PublishResult {
  twitter?: { id: string; url: string } | null;
  linkedin?: { id: string; url: string } | null;
  facebook?: { id: string; url: string } | null;
}

// ── Twitter/X API v2 ──

async function postToTwitter(text: string): Promise<{ id: string; url: string } | null> {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;

  // OAuth 1.0a signature
  const method = "POST";
  const url = "https://api.twitter.com/2/tweets";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const params: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");

  const signatureBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  const authHeader = `OAuth ${Object.entries({ ...params, oauth_signature: signature })
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ")}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error("Twitter post failed", { status: res.status, error: err });
    return null;
  }

  const data = await res.json();
  return {
    id: data.data?.id,
    url: `https://twitter.com/i/status/${data.data?.id}`,
  };
}

// ── LinkedIn API ──

async function postToLinkedIn(text: string): Promise<{ id: string; url: string } | null> {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  if (!accessToken || !orgId) return null;

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: `urn:li:organization:${orgId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error("LinkedIn post failed", { status: res.status, error: err });
    return null;
  }

  const data = await res.json();
  const postId = data.id?.replace("urn:li:share:", "") || "";
  return {
    id: postId,
    url: `https://www.linkedin.com/feed/update/urn:li:share:${postId}`,
  };
}

// ── Facebook Pages API ──

async function postToFacebook(text: string): Promise<{ id: string; url: string } | null> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_TOKEN;

  if (!pageId || !pageToken) return null;

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      access_token: pageToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error("Facebook post failed", { status: res.status, error: err });
    return null;
  }

  const data = await res.json();
  return {
    id: data.id,
    url: `https://www.facebook.com/${data.id}`,
  };
}

// ── Publish to all platforms ──

export async function publishToSocial(
  shortText: string,
  longText: string
): Promise<PublishResult> {
  const [twitter, linkedin, facebook] = await Promise.allSettled([
    postToTwitter(shortText),
    postToLinkedIn(longText),
    postToFacebook(longText),
  ]);

  return {
    twitter: twitter.status === "fulfilled" ? twitter.value : null,
    linkedin: linkedin.status === "fulfilled" ? linkedin.value : null,
    facebook: facebook.status === "fulfilled" ? facebook.value : null,
  };
}
