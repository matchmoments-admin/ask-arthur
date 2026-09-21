// TypeSafe Jev adapter — a decision-only model that returns calibrated
// probabilities instead of text.
//
// Single-purpose provider Adapter: given a `state` (the thing to decide
// about) and a set of typed questions, POSTs to TypeSafe's System One
// endpoint and returns the parsed answers. Pure provider I/O — it does NOT
// call logCost (that lives in apps/web and a package cannot import an app).
// The caller logs cost from `usage.input_tokens` this returns; output
// tokens are free on this vendor. Same division of labour as the APIVoid
// adapter beside this file.
//
// Graceful degradation is the contract: every failure mode — missing key,
// HTTP error, rate limit, timeout, malformed JSON — returns a `JevSkip`
// (`{ ok: false, reason }`), never throws. The reason lets the caller tell
// quota exhaustion (`rate_limited` — the vendor is not dead, don't bump a
// failure streak) from a genuine error.
//
// First consumer is the clone-watch Jev SHADOW LANE (v311): nothing in the
// product path reads its answers; they are persisted to be measured.
//
// Vendor facts (docs.typesafe.ai, verified 2026-09-20): three question
// types — `choice` (criteria = { optionKey: description }, answers with
// `choice` + a probability per option + `confidence`), `noul` (answers
// with a single 0..1 probability), `score` (criteria = ordered levels).
// Questions in one request are evaluated in parallel, so many questions
// cost the same latency as one. $0.042 per million INPUT tokens, output
// free. Text only. 64k tokens per request.

import { z } from "zod";

import { logger } from "@askarthur/utils/logger";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

// `jev-latest` is the vendor's stable alias. The concrete version comes
// back in every response (`model: "jev-1.13.0"`) and the caller persists
// it — the alias can move under us without notice.
const JEV_MODEL = "jev-latest";

// Vendor quotes 70–500 ms end to end. Only called from background Inngest
// steps and a backfill script, never the request path, so 8 s is generous
// without letting a stalled socket hold an Inngest slot for long.
const JEV_TIMEOUT_MS = 8_000;

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option key → one-line description. Keys come back verbatim in `choice`. */
  criteria: Record<string, string>;
}

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  /** Optional clarification of what a "yes" means. */
  criteria?: string;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered levels, lowest first. `score` indexes into these. */
  criteria: string[];
}

export type JevQuestion =
  | JevChoiceQuestion
  | JevNoulQuestion
  | JevScoreQuestion;

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.union([
    z.record(z.string(), z.number()),
    z.array(z.number()),
  ]),
  confidence: z.number(),
});

export const JevAnswerSchema = z.discriminatedUnion("type", [
  ChoiceAnswerSchema,
  NoulAnswerSchema,
  ScoreAnswerSchema,
]);
export type JevAnswer = z.infer<typeof JevAnswerSchema>;
export type JevChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type JevNoulAnswer = z.infer<typeof NoulAnswerSchema>;

// Extra top-level keys are tolerated (`.passthrough()` is implicit for
// unknown keys in z.object) so a vendor-side addition never turns into a
// `bad_shape` outage.
const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative().optional(),
  }),
});

export interface JevResult {
  ok: true;
  answers: Record<string, JevAnswer>;
  /** Concrete model version from the response, e.g. `jev-1.13.0`. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

/**
 * A call that was skipped or failed. `no-key` is a by-design skip (the
 * vendor is not configured); `rate_limited` is quota exhaustion, not a
 * dead vendor — never let it feed a failure streak. Everything else is a
 * genuine error worth a $0 diagnostic row from the caller.
 */
export interface JevSkip {
  ok: false;
  reason: "no-key" | "timeout" | "rate_limited" | "http_error" | "bad_shape";
  status?: number;
  elapsedMs: number;
}

export interface AskJevOptions {
  /** Correlation id echoed into log lines only — never sent to the vendor. */
  requestId?: string;
  /** Test seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Ask Jev a set of questions about one state. `state` may be a string or a
 * JSON object (the vendor recommends an object with named parts so the
 * instructions can reference them).
 */
export async function askJev(
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  opts: AskJevOptions = {},
): Promise<JevResult | JevSkip> {
  const apiKey = (process.env["TYPESAFE_API_KEY"] ?? "").trim();
  if (!apiKey) {
    return { ok: false, reason: "no-key", elapsedMs: 0 };
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const startedAt = Date.now();
  const logCtx = {
    requestId: opts.requestId,
    questions: Object.keys(questions).length,
  };

  let res: Response;
  try {
    res = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ state, model: JEV_MODEL, questions }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    logger.warn("jev: request failed", {
      ...logCtx,
      error: String(err).slice(0, 200),
      elapsedMs,
      timeout: isTimeout,
    });
    return {
      ok: false,
      reason: isTimeout ? "timeout" : "http_error",
      elapsedMs,
    };
  }

  const elapsedMs = Date.now() - startedAt;

  if (res.status === 429) {
    logger.warn("jev: rate limited", { ...logCtx, elapsedMs });
    return { ok: false, reason: "rate_limited", status: 429, elapsedMs };
  }
  if (!res.ok) {
    logger.warn("jev: HTTP error", {
      ...logCtx,
      status: res.status,
      elapsedMs,
    });
    return { ok: false, reason: "http_error", status: res.status, elapsedMs };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    logger.warn("jev: non-JSON body", {
      ...logCtx,
      status: res.status,
      elapsedMs,
    });
    return { ok: false, reason: "bad_shape", status: res.status, elapsedMs };
  }

  const parsed = JevResponseSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("jev: unexpected response shape", {
      ...logCtx,
      issues: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
      elapsedMs,
    });
    return { ok: false, reason: "bad_shape", status: res.status, elapsedMs };
  }

  return {
    ok: true,
    answers: parsed.data.answers,
    model: parsed.data.model,
    usage: {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens ?? 0,
    },
    elapsedMs,
  };
}
