// Embedding provider abstraction — switches between Voyage 3 (default) and
// OpenAI text-embedding-3-small via the EMBEDDING_PROVIDER env var. Both
// providers are normalised to 1024-dim vectors so the pgvector column type
// stays stable across provider swaps.
//
// Why an abstraction: Voyage 3 leads MTEB on niche-text retrieval and is
// 3x cheaper than the OpenAI fallback, but operationally the OpenAI API is
// already familiar in adjacent codebases. Building a thin switch lets us
// default to Voyage while retaining a one-env-var fallback if Voyage has an
// outage or pricing changes adversely. New consumers should call `embed()`
// — never the provider-specific functions directly.
//
// Pricing constants here MUST be kept in sync with apps/web/lib/cost-
// telemetry.ts PRICING. They are inlined because cost-telemetry lives in
// the web app and packages/* must not import upward.

import { logger } from "@askarthur/utils/logger";

export type EmbeddingProvider = "voyage" | "openai";

export const EMBEDDING_DIMENSIONS = 1024;

interface ProviderSpec {
  name: EmbeddingProvider;
  modelId: string;
  usdPerToken: number;
}

const SPECS: Record<EmbeddingProvider, ProviderSpec> = {
  voyage: {
    name: "voyage",
    modelId: "voyage-3",
    usdPerToken: 0.06 / 1_000_000,
  },
  openai: {
    name: "openai",
    modelId: "text-embedding-3-small",
    usdPerToken: 0.02 / 1_000_000,
  },
};

export interface EmbedResult {
  vectors: number[][];
  provider: EmbeddingProvider;
  modelId: string;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface EmbedOptions {
  /** Override the env-var-selected provider (rarely useful — testing only). */
  provider?: EmbeddingProvider;
  /** Optional correlation ID for log traces. */
  requestId?: string;
}

/**
 * Embed a batch of texts. Returns 1024-dim vectors for both providers.
 *
 * Throws on provider HTTP failure — Inngest's step.run boundary will retry
 * with exponential backoff. Don't swallow; let the framework handle it.
 */
export async function embed(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  if (texts.length === 0) {
    return {
      vectors: [],
      provider: opts.provider ?? selectProvider(),
      modelId: SPECS[opts.provider ?? selectProvider()].modelId,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  const provider = opts.provider ?? selectProvider();
  const spec = SPECS[provider];

  if (provider === "voyage") {
    return embedVoyage(texts, spec, opts.requestId);
  }
  return embedOpenAI(texts, spec, opts.requestId);
}

function selectProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER ?? "voyage").toLowerCase();
  if (raw === "openai") return "openai";
  if (raw === "voyage") return "voyage";
  logger.warn(`Unknown EMBEDDING_PROVIDER "${raw}", defaulting to voyage`);
  return "voyage";
}

async function embedVoyage(
  texts: string[],
  spec: ProviderSpec,
  requestId?: string,
): Promise<EmbedResult> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set — required for Voyage embeddings");
  }

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: spec.modelId,
      output_dimension: EMBEDDING_DIMENSIONS,
      input_type: "document",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("Voyage embeddings request failed", {
      requestId,
      status: res.status,
      preview: body.slice(0, 200),
    });
    throw new Error(`Voyage embeddings ${res.status}: ${body.slice(0, 200)}`);
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
    totalTokens: json.usage.total_tokens,
    estimatedCostUsd: json.usage.total_tokens * spec.usdPerToken,
  };
}

async function embedOpenAI(
  texts: string[],
  spec: ProviderSpec,
  requestId?: string,
): Promise<EmbedResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — required for OpenAI embeddings");
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: spec.modelId,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("OpenAI embeddings request failed", {
      requestId,
      status: res.status,
      preview: body.slice(0, 200),
    });
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
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
    totalTokens: json.usage.total_tokens,
    estimatedCostUsd: json.usage.total_tokens * spec.usdPerToken,
  };
}
