// ACNC Charity Register pillar — Postgres lookup against the local mirror
// (acnc_charities, populated by pipeline/scrapers/acnc_register.py).
//
// Two query paths:
//   1. ABN provided → exact PK lookup. Cheap, deterministic.
//   2. Name provided (no ABN) → trigram + Levenshtein + semantic hybrid:
//      a. search_charities() RPC for trigram + ILIKE prefix
//      b. If top trigram is exact → registered=true (no Voyage call)
//      c. Otherwise embedQuery() + match_charities_by_embedding() RPC for
//         the semantic signal that catches lookalike charities trigram
//         misses (e.g. "AU Bushfire Relief Fund" vs "Australian Bushfire
//         Relief Foundation"). The combined typosquat decision is the OR
//         of lexical (trigram + Levenshtein) and semantic.
//
// Three-signal calibration:
//   * Lexical typosquat fires when trigram >= 0.65 AND Levenshtein <= 3
//     (catches "Astralian Red Cross" → "Australian Red Cross", 1 edit;
//     filters "Cancer Foundation" colliding with anything cancer-adjacent
//     because the edit distance is too large).
//   * Semantic typosquat fires when cosine >= 0.85 AND the query is NOT a
//     substring/superstring of the matched name (catches paraphrase-style
//     impersonators; rejects "Cancer Council" matching "Cancer Council
//     Australia" — that's a less-specific name, not a typosquat).
//
// Risk mapping (0..100, higher = more risk):
//   * Exact match, registered                       →  0   (SAFE pillar)
//   * Near-miss meeting EITHER typosquat condition  → 100  (HIGH_RISK floor)
//   * Near-miss not meeting either                  → 100  (SUSPICIOUS, no floor)
//   * No match found                                → 100  (SUSPICIOUS)
//   * RPC failure / Supabase down                   → unavailable (degraded)
//
// detail payload exposes:
//   - charity_legal_name, charity_website, town_city, state, charity_size
//   - typosquat_match (bool), typosquat_signal ("lexical" | "semantic" | "both" | null)
//   - nearest_match (string), nearest_match_similarity (number),
//     nearest_match_edit_distance (number)
//   - semantic_match (string | null), semantic_similarity (number | null)

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import { embedQuery } from "@askarthur/scam-engine/embeddings";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

const PROVIDER_ID = "acnc";

/** Lexical typosquat thresholds — both must hold (AND), not either (OR).
 *  Trigram threshold is 0.65 because real-world spoofs cluster in 0.42-0.60;
 *  the Levenshtein gate is what stops false positives below 0.85. */
const TYPOSQUAT_SIMILARITY_THRESHOLD = 0.65;
const TYPOSQUAT_LEVENSHTEIN_MAX = 3;

/** Semantic typosquat threshold. 0.85 is the lower bound of the "same
 *  campaign / narrative family" cosine band on voyage-3.5 — high enough to
 *  filter out genuinely-different charities sharing keywords (e.g. "Cancer
 *  Council Australia" vs "Cancer Society Australia" usually score ~0.80),
 *  low enough to catch paraphrase impersonators. */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;

interface SearchCharitiesRow {
  abn: string;
  charity_legal_name: string;
  town_city: string | null;
  state: string | null;
  charity_website: string | null;
  similarity_score: number;
}

interface MatchByEmbeddingRow {
  abn: string;
  charity_legal_name: string;
  charity_website: string | null;
  town_city: string | null;
  state: string | null;
  similarity: number;
}

interface AcncCharityRow {
  abn: string;
  charity_legal_name: string;
  charity_website: string | null;
  town_city: string | null;
  state: string | null;
  postcode: string | null;
  charity_size: string | null;
  registration_date: string | null;
  is_pbi: boolean;
  is_hpc: boolean;
  operates_in_states: string[];
}

export const acncProvider: CharityProviderContract = {
  id: PROVIDER_ID,
  // Bumped from 2000ms to 3000ms — semantic path adds one Voyage call
  // (~150ms p95) plus one HNSW RPC (~5ms). Keeps headroom for tail latency.
  timeoutMs: 3000,
  async run(input: CharityCheckInput): Promise<CharityPillarResult> {
    const supa = createServiceClient();
    if (!supa) {
      return unavailablePillar("acnc_registration", "supabase_client_unavailable");
    }

    try {
      // Path 1: ABN provided — exact PK lookup.
      if (input.abn) {
        const { data, error } = await supa
          .from("acnc_charities")
          .select(
            "abn, charity_legal_name, charity_website, town_city, state, postcode, charity_size, registration_date, is_pbi, is_hpc, operates_in_states",
          )
          .eq("abn", input.abn)
          .maybeSingle<AcncCharityRow>();

        if (error) {
          logger.warn("acnc lookup by ABN failed", { error: String(error.message) });
          return unavailablePillar("acnc_registration", "rpc_error");
        }

        if (!data) {
          return {
            id: "acnc_registration",
            score: 100,
            confidence: 1,
            available: true,
            detail: {
              registered: false,
              reason: "abn_not_in_acnc_register",
            },
          };
        }

        return {
          id: "acnc_registration",
          score: 0,
          confidence: 1,
          available: true,
          detail: {
            registered: true,
            charity_legal_name: data.charity_legal_name,
            charity_website: data.charity_website,
            town_city: data.town_city,
            state: data.state,
            postcode: data.postcode,
            charity_size: data.charity_size,
            registration_date: data.registration_date,
            is_pbi: data.is_pbi,
            is_hpc: data.is_hpc,
            operates_in_states: data.operates_in_states,
            typosquat_match: false,
          },
        };
      }

      // Path 2: name only — trigram first, then semantic if no exact hit.
      if (input.name) {
        const { data: trigramData, error: trigramErr } = await supa.rpc(
          "search_charities",
          { p_query: input.name, p_limit: 5 },
        );

        if (trigramErr) {
          logger.warn("acnc search_charities RPC failed", {
            error: String(trigramErr.message),
          });
          return unavailablePillar("acnc_registration", "rpc_error");
        }

        const trigramRows = (trigramData ?? []) as SearchCharitiesRow[];
        const trigramTop = trigramRows[0];

        // Exact match short-circuits the semantic call — saves ~$0.0000006
        // per query at scale and a Voyage round-trip.
        if (trigramTop) {
          const isExact =
            trigramTop.similarity_score >= 1.0 ||
            trigramTop.charity_legal_name.toLowerCase().trim() ===
              input.name.toLowerCase().trim();

          if (isExact) {
            return {
              id: "acnc_registration",
              score: 0,
              confidence: 1,
              available: true,
              detail: {
                registered: true,
                charity_legal_name: trigramTop.charity_legal_name,
                charity_website: trigramTop.charity_website,
                town_city: trigramTop.town_city,
                state: trigramTop.state,
                abn: trigramTop.abn,
                typosquat_match: false,
              },
            };
          }
        }

        // No exact trigram hit — run semantic in parallel with the
        // Levenshtein computation. Either signal can independently fire
        // typosquat_match.
        const semanticTop = await runSemanticMatch(input.name);

        // Lexical signal (trigram + Levenshtein).
        const editDistance = trigramTop
          ? levenshtein(
              input.name.toLowerCase().trim(),
              trigramTop.charity_legal_name.toLowerCase().trim(),
            )
          : null;
        const lexicalTyposquat =
          trigramTop !== undefined &&
          editDistance !== null &&
          trigramTop.similarity_score >= TYPOSQUAT_SIMILARITY_THRESHOLD &&
          editDistance <= TYPOSQUAT_LEVENSHTEIN_MAX;

        // Semantic signal — only fires if the matched name is not a
        // substring/superstring of the query (otherwise it's a less-specific
        // name match, not impersonation).
        const semanticTyposquat =
          semanticTop !== null &&
          semanticTop.similarity >= SEMANTIC_SIMILARITY_THRESHOLD &&
          !isSubstringRelated(input.name, semanticTop.charity_legal_name);

        const typosquatMatch = lexicalTyposquat || semanticTyposquat;

        // No nearest match at all — no trigram hit AND no semantic hit
        // above the floor (0.55 in the RPC).
        if (!trigramTop && !semanticTop) {
          return {
            id: "acnc_registration",
            score: 100,
            confidence: 0.8,
            available: true,
            detail: {
              registered: false,
              reason: "no_name_match",
            },
          };
        }

        const typosquatSignal: "lexical" | "semantic" | "both" | null =
          lexicalTyposquat && semanticTyposquat
            ? "both"
            : lexicalTyposquat
              ? "lexical"
              : semanticTyposquat
                ? "semantic"
                : null;

        // Pick the "nearest_match" to surface — prefer the higher-confidence
        // signal. If semantic fired and trigram didn't, surface the semantic
        // hit; otherwise default to the trigram hit.
        const surfaceTop =
          semanticTyposquat && !lexicalTyposquat && semanticTop
            ? {
                charity_legal_name: semanticTop.charity_legal_name,
                abn: semanticTop.abn,
                similarity: semanticTop.similarity,
                source: "semantic" as const,
              }
            : trigramTop
              ? {
                  charity_legal_name: trigramTop.charity_legal_name,
                  abn: trigramTop.abn,
                  similarity: trigramTop.similarity_score,
                  source: "trigram" as const,
                }
              : null;

        return {
          id: "acnc_registration",
          score: 100,
          confidence: typosquatMatch ? 0.9 : 0.6,
          available: true,
          detail: {
            registered: false,
            reason: typosquatMatch ? "typosquat_near_match" : "no_exact_name_match",
            nearest_match: surfaceTop?.charity_legal_name ?? null,
            nearest_match_abn: surfaceTop?.abn ?? null,
            nearest_match_similarity: surfaceTop?.similarity ?? null,
            nearest_match_edit_distance: editDistance,
            nearest_match_source: surfaceTop?.source ?? null,
            typosquat_match: typosquatMatch,
            typosquat_signal: typosquatSignal,
            semantic_match: semanticTop?.charity_legal_name ?? null,
            semantic_similarity: semanticTop?.similarity ?? null,
          },
        };
      }

      // Should never happen — the input schema rejects this case.
      return unavailablePillar("acnc_registration", "no_query_input");
    } catch (err) {
      logger.warn("acnc provider threw", { error: String(err) });
      return unavailablePillar("acnc_registration", "exception");
    }
  },
};

/**
 * Run the semantic name match: embed the query, then call the
 * match_charities_by_embedding RPC. Returns the top hit (or null on no
 * match / failure). Failures are non-fatal — the lexical path still runs.
 */
async function runSemanticMatch(
  name: string,
): Promise<MatchByEmbeddingRow | null> {
  try {
    const supa = createServiceClient();
    if (!supa) return null;

    const result = await embedQuery([name], { domain: "generic" });
    if (result.vectors.length === 0) return null;

    // Cost is logged via cost_telemetry by the caller chain — for the
    // consumer-path call here, the per-call $ is tiny (~$0.0000006) and
    // the dashboard's daily aggregate matters more than per-call rows.
    // Skipping insert here keeps the consumer path fast.

    const { data, error } = await supa.rpc("match_charities_by_embedding", {
      p_query_embedding: vectorToPgString(result.vectors[0]),
      p_match_count: 5,
      p_min_similarity: 0.55,
    });

    if (error) {
      logger.warn("match_charities_by_embedding RPC failed", {
        error: String(error.message),
      });
      return null;
    }

    const rows = (data ?? []) as MatchByEmbeddingRow[];
    return rows[0] ?? null;
  } catch (err) {
    logger.warn("runSemanticMatch threw", { error: String(err) });
    return null;
  }
}

/**
 * pgvector wire format — bracketed text `[1,2,3]` rather than the JSON
 * array supabase-js would otherwise serialise. PostgREST forwards it as a
 * string and pgvector parses it on receipt.
 */
function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

/**
 * True if either string contains the other after normalisation. Used to
 * distinguish "less-specific name match" (legitimate) from "paraphrase
 * impersonator" (suspicious). Example:
 *   "Cancer Council" ⊂ "Cancer Council Australia" → true (don't flag)
 *   "Save Australian Children" vs "Save the Children Australia" → false (flag)
 */
export function isSubstringRelated(a: string, b: string): boolean {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  return na.includes(nb) || nb.includes(na);
}

/**
 * Standard Levenshtein edit distance — minimum number of single-character
 * insertions, deletions, or substitutions to turn `a` into `b`. O(n*m)
 * time, O(min(n,m)) space (single rolling row). Inputs are expected to
 * be already case-normalised by the caller. Inlined here rather than
 * pulled from a util because the only consumer is the typosquat path.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const m = shorter.length;
  const n = longer.length;

  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = shorter[i - 1] === longer[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,
        prev[i] + 1,
        prev[i - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}
