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

export type EmbeddingProvider = "voyage" | "openai";
export type EmbeddingDomain = "generic" | "finance" | "multimodal";

export const EMBEDDING_DIMENSIONS = 1024;

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

  if (spec.provider === "voyage") {
    return callVoyage(texts, spec, inputType, opts.requestId);
  }
  return callOpenAI(texts, spec, opts.requestId);
}

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

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

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

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

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
