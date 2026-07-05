import { readStringEnv } from "@askarthur/utils/env";

/**
 * Minimal LinkedIn client for publishing a monthly document (PDF carousel) post
 * to the Ask Arthur company page, plus a first comment carrying the link.
 *
 * Concentrates every LinkedIn-API quirk in one place (deletion test): the
 * versioned headers, the 3-call document flow, URN encoding, x-restli-id post
 * URN parsing, and the refresh-token grant. Consumers just call
 * publishDocumentPost() / addComment().
 *
 * Requires the Community Management API product on the app (Development Tier is
 * enough) and a token with w_organization_social. Verified flow (2026):
 *   POST /rest/documents?action=initializeUpload -> PUT binary -> POST /rest/posts
 */

const REST = "https://api.linkedin.com/rest";
const OAUTH = "https://www.linkedin.com/oauth/v2/accessToken";

/** Versioned-API moniker (YYYYMM). Overridable as LinkedIn sunsets versions. */
function apiVersion(): string {
  return readStringEnv("LINKEDIN_API_VERSION") || "202606";
}

function jsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 500)}` : ""}`;
}

/**
 * Resolve a usable access token. Prefers minting a FRESH one from the refresh
 * token (so a 60-day access token can't silently expire between monthly runs);
 * falls back to the static LINKEDIN_ACCESS_TOKEN when no refresh token is set.
 */
export async function resolveAccessToken(): Promise<string> {
  const refresh = readStringEnv("LINKEDIN_REFRESH_TOKEN");
  const clientId = readStringEnv("LINKEDIN_CLIENT_ID");
  const clientSecret = readStringEnv("LINKEDIN_CLIENT_SECRET");
  if (refresh && clientId && clientSecret) {
    const res = await fetch(OAUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) throw new Error(`linkedin token refresh failed: ${await readError(res)}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("linkedin token refresh returned no access_token");
    return data.access_token;
  }
  const stat = readStringEnv("LINKEDIN_ACCESS_TOKEN");
  if (!stat) throw new Error("no LINKEDIN_REFRESH_TOKEN (+client id/secret) or LINKEDIN_ACCESS_TOKEN configured");
  return stat;
}

/** The org (page) URN we post as, e.g. urn:li:organization:114874091. */
export function orgUrn(): string {
  const urn = readStringEnv("LINKEDIN_ORG_URN");
  if (!urn) throw new Error("LINKEDIN_ORG_URN not configured");
  return urn;
}

/**
 * Upload a document (PDF) and return its URN. Non-destructive: an uploaded
 * document that isn't attached to a post is not publicly visible - so this is
 * safe to run to validate auth/scopes/versioned-API access.
 */
export async function uploadDocument(
  pdf: Uint8Array,
  accessToken: string,
  ownerUrn = orgUrn(),
): Promise<string> {
  const initRes = await fetch(`${REST}/documents?action=initializeUpload`, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
  });
  if (!initRes.ok) throw new Error(`document initializeUpload failed: ${await readError(initRes)}`);
  const init = (await initRes.json()) as { value?: { uploadUrl?: string; document?: string } };
  const uploadUrl = init.value?.uploadUrl;
  const documentUrn = init.value?.document;
  if (!uploadUrl || !documentUrn) throw new Error("initializeUpload returned no uploadUrl/document");

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    // undici's fetch accepts a Uint8Array body at runtime; the cast sidesteps
    // the TS 5.7 typed-array/ArrayBufferLike generic mismatch on BodyInit.
    body: pdf as unknown as BodyInit,
  });
  if (!putRes.ok) throw new Error(`document binary upload failed: ${await readError(putRes)}`);
  return documentUrn;
}

/**
 * Create a PUBLISHED document post on the org page. Returns the post URN.
 * DESTRUCTIVE - this publishes publicly to the page.
 */
export async function createDocumentPost(opts: {
  documentUrn: string;
  title: string;
  commentary: string;
  accessToken: string;
  authorUrn?: string;
}): Promise<string> {
  const author = opts.authorUrn ?? orgUrn();
  const res = await fetch(`${REST}/posts`, {
    method: "POST",
    headers: jsonHeaders(opts.accessToken),
    body: JSON.stringify({
      author,
      commentary: opts.commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { title: opts.title, id: opts.documentUrn } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (res.status !== 201) throw new Error(`create post failed: ${await readError(res)}`);
  const postUrn = res.headers.get("x-restli-id");
  if (!postUrn) throw new Error("create post succeeded but no x-restli-id header");
  return postUrn;
}

/** Add a comment (e.g. the link) to a post. Actor defaults to the org. */
export async function addComment(opts: {
  postUrn: string;
  text: string;
  accessToken: string;
  actorUrn?: string;
}): Promise<void> {
  const actor = opts.actorUrn ?? orgUrn();
  const res = await fetch(
    `${REST}/socialActions/${encodeURIComponent(opts.postUrn)}/comments`,
    {
      method: "POST",
      headers: jsonHeaders(opts.accessToken),
      body: JSON.stringify({
        actor,
        object: opts.postUrn,
        message: { text: opts.text },
      }),
    },
  );
  if (res.status !== 201 && !res.ok) {
    throw new Error(`add comment failed: ${await readError(res)}`);
  }
}

/** A LinkedIn post URN -> its public feed URL. */
export function postUrl(postUrn: string): string {
  // e.g. urn:li:share:12345 -> https://www.linkedin.com/feed/update/urn:li:share:12345
  return `https://www.linkedin.com/feed/update/${postUrn}`;
}
