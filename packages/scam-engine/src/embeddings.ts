// Embedding provider abstraction — routes by `domain` ("generic" | "finance"
// | "multimodal") to a model-id-keyed registry. Generic defaults to Voyage
// 3.5 with OpenAI text-embedding-3-small as a fallback (kept under the legacy
// EMBEDDING_PROVIDER env var). Finance routes to voyage-finance-2 for
// investment / crypto / BEC text where the generic model under-recalls
// finance jargon. Multimodal is registered for forward-compat but throws on
// call — the voyage-multimodal-3.5 request shape (interleaved image/video
// content blocks) lands in a later phase.
//
// All vectors are normalised to 1024 dim so the pgvector column type stays
// stable across model swaps. voyage-3.5 / voyage-3.5-lite / voyage-multimodal
// support Matryoshka so we explicitly request 1024; voyage-finance-2 returns
// 1024 natively (no output_dimension param). text-embedding-3-small accepts
// `dimensions: 1024` and produces a normalised 1024-dim vector.
//
// Document vs query: Voyage models are trained with an asymmetric prompt —
// `input_type=document` for stored text, `input_type=query` for retrieval
// queries. Skipping the distinction silently halves recall. Encoded as the
// embed() / embedQuery() split so callers can't forget. OpenAI is symmetric
// so the helper is a no-op there.
//
// Model versioning: every embedding written to a pgvector column MUST be
// accompanied by the modelId from EmbedResult, persisted in a sibling
// *_model_version column. See docs/adr/0003-embedding-model-versioning.md.
//
// Pricing constants here MUST be kept in sync with apps/web/lib/cost-
// telemetry.ts PRICING. They are inlined because cost-telemetry lives in
// the web app and packages/* must not import upward.

import { logger } from "@askarthur/utils/logger";
import { getCachedEmbedding, setCachedEmbedding } from "./embedding-cache";

export type EmbeddingProvider = "voyage" | "openai";
export type EmbeddingDomain = "generic" | "finance" | "multimodal";

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Per-request timeout for a provider embedding call, in milliseconds.
 *
 * WHY THIS EXISTS. Until #1134 there was NO timeout on either provider fetch —
 * no `AbortSignal` anywhere in this file. Every embedding call happens inside
 * an Inngest `step.run`, and an Inngest step holds one of the account's five
 * concurrency slots for its whole duration (ADR-0019). An unbounded provider
 * call inside a step is therefore a slot held indefinitely by a hung socket,
 * on the one resource the fleet is measured at 5/5 in use.
 *
 * 30s is roughly fifteen times the observed round trip for a full
 * EMBED_CHUNK_TEXTS (20) chunk, so it cannot fire on a healthy call; it exists
 * to bound a hang, not to pace a slow one. Chunks run sequentially, so the
 * worst case a caller sees is chunks x this value — which is why the callers'
 * own in-step budgets (CLUSTER_BATCH_WALL_CLOCK_MS and friends) are the real
 * ceiling and this is the per-socket floor beneath them.
 *
 * GUARDED PARSE, deliberately. `Number("")` is 0 and `Number("30s")` is NaN,
 * and either would mean "abort immediately" or "never abort" — the same class
 * of silent disable as `parseFloat("$10")` on a cost brake (CLAUDE.md). A
 * non-finite or non-positive override falls back to the default rather than
 * disabling the bound.
 */
export const EMBED_REQUEST_TIMEOUT_MS_DEFAULT = 30_000;

export function embedRequestTimeoutMs(): number {
  const raw = Number(
    process.env["EMBED_REQUEST_TIMEOUT_MS"] ?? EMBED_REQUEST_TIMEOUT_MS_DEFAULT,
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : EMBED_REQUEST_TIMEOUT_MS_DEFAULT;
}

/**
 * One fetch with the embedding timeout applied and an abort translated into a
 * named error.
 *
 * Both providers need identical treatment, and a bare `AbortSignal.timeout`
 * rejection surfaces as a `TimeoutError` DOMException whose message says
 * nothing about which provider or which budget — three steps from the cause,
 * which is the shape this repo keeps paying for. Deletion test: removing this
 * would put the same signal, the same catch and the same translation in both
 * callVoyage and callOpenAI.
 */
async function embedFetch(
  url: string,
  init: RequestInit,
  provider: EmbeddingProvider,
  ctx: { requestId?: string; modelId: string },
): Promise<Response> {
  const timeoutMs = embedRequestTimeoutMs();
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      logger.error("Embedding request timed out", {
        requestId: ctx.requestId,
        provider,
        modelId: ctx.modelId,
        timeoutMs,
      });
      throw new Error(
        `${provider} embeddings timed out after ${timeoutMs}ms (model ${ctx.modelId})`,
      );
    }
    throw err;
  }
}

interface ModelSpec {
  provider: EmbeddingProvider;
  modelId: string;
  domain: EmbeddingDomain;
  usdPerToken: number;
  // True when the model supports the Matryoshka `output_dimension` (Voyage)
  // or `dimensions` (OpenAI) param. False for fixed-dim models — request
  // omits the param and uses the model's native dim.
  supportsTruncation: boolean;
  // False = registered for env-var routing but the call path isn't wired
  // yet. Throws on invocation so a misconfigured env var fails loudly
  // rather than silently routing to the wrong model.
  callPathReady: boolean;
}

const MODEL_REGISTRY: Record<string, ModelSpec> = {
  "voyage-3.5": {
    provider: "voyage",
    modelId: "voyage-3.5",
    domain: "generic",
    usdPerToken: 0.06 / 1_000_000,
    supportsTruncation: true,
    callPathReady: true,
  },
  "voyage-3.5-lite": {
    provider: "voyage",
    modelId: "voyage-3.5-lite",
    domain: "generic",
    usdPerToken: 0.02 / 1_000_000,
    supportsTruncation: true,
    callPathReady: true,
  },
  "voyage-finance-2": {
    provider: "voyage",
    modelId: "voyage-finance-2",
    domain: "finance",
    usdPerToken: 0.12 / 1_000_000,
    supportsTruncation: false,
    callPathReady: true,
  },
  "voyage-multimodal-3.5": {
    provider: "voyage",
    modelId: "voyage-multimodal-3.5",
    domain: "multimodal",
    // Text-only token rate; image inputs additionally bill per pixel via the
    // multimodal endpoint when that path lands.
    usdPerToken: 0.06 / 1_000_000,
    supportsTruncation: true,
    callPathReady: false,
  },
  "text-embedding-3-small": {
    provider: "openai",
    modelId: "text-embedding-3-small",
    domain: "generic",
    usdPerToken: 0.02 / 1_000_000,
    supportsTruncation: true,
    callPathReady: true,
  },
};

const DOMAIN_DEFAULTS: Record<EmbeddingDomain, string> = {
  generic: "voyage-3.5",
  finance: "voyage-finance-2",
  multimodal: "voyage-multimodal-3.5",
};

// One-shot env-routing health check. Logs a loud warning if any
// EMBEDDING_MODEL_<DOMAIN> env var routes to a model whose call path
// is not yet implemented. Without this check, a misconfigured deploy
// can sit silently for hours until the first embed in that domain
// throws — typically inside an Inngest cron, far from the source of
// the misconfig. Idempotent across hot reloads via the module-level
// `_envCheckDone` flag.
let _envCheckDone = false;
function checkEnvRoutingHealth(): void {
  if (_envCheckDone) return;
  _envCheckDone = true;
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("EMBEDDING_MODEL_")) continue;
    if (!value) continue;
    const spec = MODEL_REGISTRY[value];
    if (spec && !spec.callPathReady) {
      logger.warn(
        `${key}="${value}" routes to a model whose call path is NOT yet ` +
          `implemented (domain=${spec.domain}). Any embed() / embedQuery() ` +
          `against this domain will throw at invocation. Unset the env var ` +
          `or wait until the call path lands.`,
      );
    }
  }
}
checkEnvRoutingHealth();

export interface EmbedResult {
  vectors: number[][];
  provider: EmbeddingProvider;
  modelId: string;
  domain: EmbeddingDomain;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface EmbedOptions {
  // Domain selects which model id is used. Defaults to "generic". A
  // per-domain env var (EMBEDDING_MODEL_GENERIC / _FINANCE / _MULTIMODAL)
  // can override the default model id.
  domain?: EmbeddingDomain;
  // Direct model-id override — bypasses domain routing entirely. Use for
  // pinned reindex jobs where the model must match what's already in the
  // *_model_version column.
  modelId?: string;
  // Optional correlation ID for log traces.
  requestId?: string;
  /**
   * Milliseconds to wait BETWEEN provider requests when a call is large
   * enough to be chunked. Defaults to 0 — see EMBED_CHUNK_PAUSE_MS_DEFAULT.
   *
   * Only set this from a caller that is NOT inside an Inngest step. Sleeping
   * inside a step holds a concurrency slot, and this project has five.
   */
  chunkPauseMs?: number;
}

/**
 * Embed a batch of documents (text intended to be stored and searched
 * against later). Returns 1024-dim vectors for every supported model.
 *
 * For one-off retrieval queries, use `embedQuery()` instead — it sets
 * Voyage's `input_type=query` so the embedding sits in the matched
 * half of Voyage's asymmetric prompt space. Skipping that distinction
 * silently halves recall.
 *
 * Throws on provider HTTP failure — Inngest's step.run boundary will retry
 * with exponential backoff. Don't swallow; let the framework handle it.
 */
export async function embed(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  return embedInternal(texts, "document", opts);
}

/**
 * Embed one or more retrieval queries. Returns 1024-dim vectors.
 *
 * For Voyage, sets `input_type=query` so the model uses the query-side
 * prompt template; this is the matched counterpart to `embed()`'s
 * `input_type=document`. For OpenAI (symmetric embeddings) this is
 * functionally identical to `embed()`.
 *
 * Use this whenever the embedding is going to be cosine-compared against
 * already-stored document vectors — search endpoints, similarity
 * surfaces, reranker prep. Do NOT use for text that will itself be
 * stored as a document.
 */
export async function embedQuery(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  return embedInternal(texts, "query", opts);
}

type VoyageInputType = "document" | "query";

async function embedInternal(
  texts: string[],
  inputType: VoyageInputType,
  opts: EmbedOptions,
): Promise<EmbedResult> {
  const spec = resolveSpec(opts);

  if (!spec.callPathReady) {
    throw new Error(
      `Embedding model "${spec.modelId}" (domain=${spec.domain}) is registered but its call path is not yet implemented. ` +
        `For multimodal embeddings, the voyage-multimodal-3.5 request shape lands in a later phase.`,
    );
  }

  if (texts.length === 0) {
    return {
      vectors: [],
      provider: spec.provider,
      modelId: spec.modelId,
      domain: spec.domain,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  // Single-text fast path: consult Redis cache. Skip for batches —
  // they're typically backfill paths where every text is unique, so
  // the MGET overhead doesn't earn its keep. Cache hit returns
  // totalTokens=0 / estimatedCostUsd=0 so the cost-telemetry caller
  // sees a free row (legitimate — no Voyage call was made).
  if (texts.length === 1) {
    const cached = await getCachedEmbedding(spec.modelId, inputType, texts[0]);
    if (cached) {
      return {
        vectors: cached.vectors,
        provider: spec.provider,
        modelId: cached.modelId,
        domain: spec.domain,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
    }
  }

  const result = await callInChunks(
    texts,
    spec,
    inputType,
    opts.requestId,
    opts.chunkPauseMs,
  );

  // Populate cache on success — fire-and-forget, never blocks.
  if (texts.length === 1 && result.vectors.length === 1) {
    void setCachedEmbedding(spec.modelId, inputType, texts[0], result.vectors);
  }

  return result;
}

/**
 * Provider request sizing. One request per chunk, paced between chunks.
 *
 * WHY THIS EXISTS. `embed()` used to hand the provider every text in one
 * request, however many there were. That was correct for the size it was
 * built at — the Reddit cohort is ~40 posts a day — and it stayed correct
 * until a backfill made the cohort 500. Voyage returned 429 and the run died:
 *
 *   Voyage embeddings 429: "You have not yet added your payment method ...
 *   reduced rate limits of 3 RPM and 10K TPM"
 *
 * 500 rows is roughly 50,000 tokens in one request against a 10,000-per-minute
 * ceiling. Inngest retried three times, each retry sent the same oversized
 * request, and 976 rows were left with no embedding and therefore no theme.
 *
 * Seven jobs call `embed()`, two of them backfills that will pass large
 * arrays for the same reason. Chunking one caller would leave six carrying
 * the same latent defect, so it lives here — the deletion test favours one
 * home over seven.
 *
 * Sized for the FREE tier deliberately. The point is a call path that is
 * correct at any input size, not one that merely needs a bigger quota; a
 * paid tier makes this faster, not necessary. Both knobs are env-tunable so
 * raising the quota does not need a deploy.
 */
const EMBED_CHUNK_TEXTS = Number(
  process.env.EMBED_CHUNK_TEXTS ?? 20,
);
/** Rough char/4 heuristic — enough to keep a chunk under the token ceiling. */
const EMBED_CHUNK_TOKENS = Number(
  process.env.EMBED_CHUNK_TOKENS ?? 3_000,
);
/**
 * Pacing between chunks. DEFAULT ZERO, and opt-in per call — the split from
 * chunking is deliberate and was a correction.
 *
 * Chunking is universally safe: smaller requests are strictly better for
 * every caller. Pacing is not. The first version paced by default at 20s,
 * and that sleep happens INSIDE whatever is calling — which for six of the
 * seven callers is an Inngest `step.run`, holding one of five concurrency
 * slots for the entire wait. Measured against the real batch sizes:
 *
 *   acnc-charity-backfill-embed   200/batch -> 180s per step, up to 75 min/run
 *   scam-reports-backfill-embed   100/batch ->  80s per step, up to 67 min/run
 *
 * Long inline steps holding slots is the documented cause of a fleet-wide
 * run-cancellation incident on this project. Pacing every caller by default
 * would have traded a rate-limit bug for that.
 *
 * So callers that can afford to wait ask for it. In practice that is the
 * operator drain script, which runs locally and holds no slot. An Inngest
 * job should instead size its batch so the request count fits the provider's
 * per-minute allowance, and let Inngest's own retries handle the rest.
 */
const EMBED_CHUNK_PAUSE_MS_DEFAULT = Number(
  process.env.EMBED_CHUNK_PAUSE_MS ?? 0,
);

function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const t of texts) {
    const est = Math.ceil(t.length / 4);
    if (
      current.length > 0 &&
      (current.length >= EMBED_CHUNK_TEXTS ||
        tokens + est > EMBED_CHUNK_TOKENS)
    ) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
    current.push(t);
    tokens += est;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function callInChunks(
  texts: string[],
  spec: ModelSpec,
  inputType: VoyageInputType,
  requestId?: string,
  pauseMs: number = EMBED_CHUNK_PAUSE_MS_DEFAULT,
): Promise<EmbedResult> {
  const chunks = chunkTexts(texts);

  // The overwhelming majority of calls — every query path, every single-text
  // embed — are one chunk, and take exactly the path they always did.
  if (chunks.length === 1) {
    return spec.provider === "voyage"
      ? await callVoyage(texts, spec, inputType, requestId)
      : await callOpenAI(texts, spec, requestId);
  }

  const vectors: number[][] = [];
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  for (let i = 0; i < chunks.length; i++) {
    // Paced, not just chunked. Splitting a 50,000-token request into fifteen
    // 3,000-token ones still breaches a per-MINUTE ceiling if they all leave
    // at once.
    if (i > 0 && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
    const res =
      spec.provider === "voyage"
        ? await callVoyage(chunks[i], spec, inputType, requestId)
        : await callOpenAI(chunks[i], spec, requestId);

    // ORDER IS THE CONTRACT. Callers match vectors to rows by index —
    // reddit-intel-embed writes `result.vectors[i]` onto `rows[i]` — so a
    // reordering here attaches every embedding to the wrong post and nothing
    // would ever surface it. Chunks are consumed in order and appended in
    // order, and `embeddings.chunking.test.ts` asserts it.
    vectors.push(...res.vectors);
    totalTokens += res.totalTokens;
    estimatedCostUsd += res.estimatedCostUsd;
  }

  return {
    vectors,
    provider: spec.provider,
    modelId: spec.modelId,
    domain: spec.domain,
    totalTokens,
    estimatedCostUsd,
  };
}

/** Exported for tests — the chunk boundaries are the part worth asserting. */
export const __testing = {
  chunkTexts,
  EMBED_CHUNK_TEXTS,
  EMBED_CHUNK_TOKENS,
  EMBED_CHUNK_PAUSE_MS_DEFAULT,
};

function resolveSpec(opts: EmbedOptions): ModelSpec {
  if (opts.modelId) {
    const spec = MODEL_REGISTRY[opts.modelId];
    if (!spec) {
      throw new Error(
        `Unknown modelId "${opts.modelId}" — not in MODEL_REGISTRY. Add it before embedding.`,
      );
    }
    return spec;
  }
  return selectModelSpec(opts.domain ?? "generic");
}

function selectModelSpec(domain: EmbeddingDomain): ModelSpec {
  const envKey = `EMBEDDING_MODEL_${domain.toUpperCase()}`;
  const explicit = process.env[envKey];
  if (explicit) {
    const spec = MODEL_REGISTRY[explicit];
    if (spec) return spec;
    logger.warn(
      `Unknown ${envKey}="${explicit}", falling back to default for domain=${domain}`,
    );
  }

  // Backward-compat: EMBEDDING_PROVIDER applies only to the generic domain.
  // It is the original "swap voyage for openai" lever from before domain
  // routing existed; finance/multimodal never had an OpenAI counterpart.
  if (domain === "generic") {
    const raw = (process.env.EMBEDDING_PROVIDER ?? "voyage").toLowerCase();
    if (raw === "openai") return MODEL_REGISTRY["text-embedding-3-small"];
    if (raw !== "voyage") {
      logger.warn(`Unknown EMBEDDING_PROVIDER "${raw}", defaulting to voyage`);
    }
  }

  const fallback = MODEL_REGISTRY[DOMAIN_DEFAULTS[domain]];
  if (!fallback) {
    throw new Error(
      `Internal error: domain "${domain}" has no default model registered`,
    );
  }
  return fallback;
}

async function callVoyage(
  texts: string[],
  spec: ModelSpec,
  inputType: VoyageInputType,
  requestId?: string,
): Promise<EmbedResult> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set — required for Voyage embeddings");
  }

  const body: Record<string, unknown> = {
    input: texts,
    model: spec.modelId,
    input_type: inputType,
  };
  if (spec.supportsTruncation) {
    body.output_dimension = EMBEDDING_DIMENSIONS;
  }

  const res = await embedFetch(
    "https://api.voyageai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    "voyage",
    { requestId, modelId: spec.modelId },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logger.error("Voyage embeddings request failed", {
      requestId,
      status: res.status,
      modelId: spec.modelId,
      inputType,
      preview: errBody.slice(0, 200),
    });
    throw new Error(
      `Voyage embeddings ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
    usage: { total_tokens: number };
  };

  // Voyage returns data sorted by index but we don't trust ordering — sort
  // explicitly so the output array indexes line up with the input array.
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => d.embedding);

  return {
    vectors,
    provider: "voyage",
    modelId: spec.modelId,
    domain: spec.domain,
    totalTokens: json.usage.total_tokens,
    estimatedCostUsd: json.usage.total_tokens * spec.usdPerToken,
  };
}

async function callOpenAI(
  texts: string[],
  spec: ModelSpec,
  requestId?: string,
): Promise<EmbedResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — required for OpenAI embeddings");
  }

  const body: Record<string, unknown> = {
    input: texts,
    model: spec.modelId,
  };
  if (spec.supportsTruncation) {
    body.dimensions = EMBEDDING_DIMENSIONS;
  }

  const res = await embedFetch(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    "openai",
    { requestId, modelId: spec.modelId },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logger.error("OpenAI embeddings request failed", {
      requestId,
      status: res.status,
      modelId: spec.modelId,
      preview: errBody.slice(0, 200),
    });
    throw new Error(
      `OpenAI embeddings ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
    usage: { prompt_tokens: number; total_tokens: number };
  };

  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => d.embedding);

  return {
    vectors,
    provider: "openai",
    modelId: spec.modelId,
    domain: spec.domain,
    totalTokens: json.usage.total_tokens,
    estimatedCostUsd: json.usage.total_tokens * spec.usdPerToken,
  };
}
