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

/**
 * Create a PUBLISHED article (link) post on the org page. Returns the post URN.
 * DESTRUCTIVE - this publishes publicly to the page.
 *
 * The other shape of post: instead of carrying a document, it carries a URL and
 * LinkedIn renders a preview card from it. Use this when the destination IS the
 * artifact — an interactive page beats a flattened screenshot of one, and the
 * card is tappable where carousel slides are not.
 *
 * `title`/`description` are sent explicitly rather than left for LinkedIn to
 * scrape. Scraping usually works — /hub serves correct og:title, og:description
 * and og:image — but "usually" is decided by a cache we do not control, and a
 * post that renders bare cannot be fixed after the fact (LinkedIn holds a
 * preview ~7 days and its Post Inspector only corrects FUTURE posts).
 *
 * No `thumbnail`: that field takes an uploaded image URN, and supplying one
 * would fork the card art away from the route's own opengraph-image, which is
 * the thing every other surface already shows. LinkedIn fetches og:image.
 */
export async function createArticlePost(opts: {
  url: string;
  title: string;
  description: string;
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
      content: {
        article: {
          source: opts.url,
          title: opts.title,
          description: opts.description,
        },
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (res.status !== 201) throw new Error(`create article post failed: ${await readError(res)}`);
  const postUrn = res.headers.get("x-restli-id");
  if (!postUrn) throw new Error("create article post succeeded but no x-restli-id header");
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

export interface PostVerification {
  ok: boolean;
  /** Human-readable problems; empty when ok. */
  problems: string[];
  lifecycleState?: string;
  visibility?: string;
  feedDistribution?: string;
  documentStatus?: string;
  /** Did the post show up in the org's own author-listing? */
  inAuthorListing?: boolean;
}

/**
 * Re-read a just-published post and assert it is in the state we asked for.
 *
 * WHAT THIS CAN AND CANNOT PROVE — read before trusting a green result.
 * It CAN catch: a post that failed to reach PUBLISHED, lost PUBLIC
 * visibility or MAIN_FEED distribution, lost its document, has a document
 * still PROCESSING or FAILED, or vanished from the org's own post list.
 * It CANNOT prove a member actually sees the post in a feed: LinkedIn
 * exposes no member-visibility signal at this tier (socialActions is
 * 403 on Development tier), and a post can be API-healthy on every field
 * while still being withheld from the UI.
 *
 * That is not hypothetical — it is why this function exists. The July 2026
 * edition returned 201, read back PUBLISHED / PUBLIC / MAIN_FEED with an
 * AVAILABLE document, appeared in the author-listing, and STILL rendered
 * "Post cannot be displayed" and never appeared in the page's post list.
 * So: a green verification is necessary, not sufficient — the caller must
 * still tell a human to eyeball the URL.
 */
export async function verifyPost(opts: {
  postUrn: string;
  accessToken: string;
  authorUrn?: string;
  /** Read-after-write retries. LinkedIn 404s a just-created post for a second
   *  or two; without this the check cried wolf on a perfectly good post (seen
   *  2026-08-08). Set 0 in tests to keep them instant. */
  retries?: number;
  retryDelayMs?: number;
  /** Which post shape to assert. "document" expects an attached, processed
   *  document; "article" expects a link card and NO document. Defaults to
   *  "document" so existing callers are unchanged. */
  shape?: "document" | "article";
}): Promise<PostVerification> {
  const problems: string[] = [];
  const out: PostVerification = { ok: false, problems };

  // Read-after-write is eventually consistent: retry a 404 before believing it.
  const attempts = (opts.retries ?? 4) + 1;
  const delay = opts.retryDelayMs ?? 3000;
  let res!: Response;
  for (let i = 0; i < attempts; i++) {
    res = await fetch(`${REST}/posts/${encodeURIComponent(opts.postUrn)}`, {
      headers: jsonHeaders(opts.accessToken),
    });
    if (res.status !== 404) break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delay));
  }
  if (!res.ok) {
    problems.push(
      `post not readable back (HTTP ${res.status}${res.status === 404 ? ` after ${attempts} attempts` : ""})`,
    );
    return out;
  }
  const post = (await res.json()) as {
    lifecycleState?: string;
    visibility?: string;
    distribution?: { feedDistribution?: string };
    content?: { media?: { id?: string }; article?: { source?: string } };
  };

  out.lifecycleState = post.lifecycleState;
  out.visibility = post.visibility;
  out.feedDistribution = post.distribution?.feedDistribution;
  if (post.lifecycleState !== "PUBLISHED") {
    problems.push(`lifecycleState is ${post.lifecycleState ?? "missing"}, expected PUBLISHED`);
  }
  if (post.visibility !== "PUBLIC") {
    problems.push(`visibility is ${post.visibility ?? "missing"}, expected PUBLIC`);
  }
  if (post.distribution?.feedDistribution !== "MAIN_FEED") {
    problems.push(
      `feedDistribution is ${post.distribution?.feedDistribution ?? "missing"}, expected MAIN_FEED`,
    );
  }

  // Shape-specific content check. An ARTICLE post correctly carries no
  // document — asserting one flagged the first healthy link post as
  // "post has no attached document" (2026-08-21). A verifier that cries wolf
  // is worse than none: this repo has already been bitten by a green check
  // that meant nothing, and the inverse trains people to ignore a real one.
  if (opts.shape === "article") {
    if (!post.content?.article?.source) {
      problems.push("article post has no link source");
    }
    out.ok = problems.length === 0;
    return out;
  }

  // The attached document must be finished processing, or the carousel
  // renders as a dead tile even on an otherwise-healthy post.
  const documentUrn = post.content?.media?.id;
  if (!documentUrn) {
    problems.push("post has no attached document");
  } else {
    const dres = await fetch(`${REST}/documents/${encodeURIComponent(documentUrn)}`, {
      headers: jsonHeaders(opts.accessToken),
    });
    if (!dres.ok) {
      problems.push(`document not readable (HTTP ${dres.status})`);
    } else {
      const doc = (await dres.json()) as { status?: string };
      out.documentStatus = doc.status;
      if (doc.status !== "AVAILABLE") {
        problems.push(`document status is ${doc.status ?? "missing"}, expected AVAILABLE`);
      }
    }
  }

  // Does the org's own post listing include it? Cheapest available proxy for
  // "LinkedIn considers this a real post on the page".
  const author = encodeURIComponent(opts.authorUrn ?? orgUrn());
  const lres = await fetch(
    `${REST}/posts?author=${author}&q=author&count=10&sortBy=LAST_MODIFIED`,
    { headers: jsonHeaders(opts.accessToken) },
  );
  if (lres.ok) {
    const list = (await lres.json()) as { elements?: Array<{ id?: string }> };
    out.inAuthorListing = (list.elements ?? []).some((e) => e.id === opts.postUrn);
    if (!out.inAuthorListing) problems.push("post absent from the org's own recent-post listing");
  } else {
    problems.push(`author listing not readable (HTTP ${lres.status}) — could not confirm presence`);
  }

  out.ok = problems.length === 0;
  return out;
}
