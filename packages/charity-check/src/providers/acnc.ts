// ACNC Charity Register pillar — Postgres lookup against the local mirror
// (acnc_charities, populated by pipeline/scrapers/acnc_register.py).
//
// Two query paths:
//   1. ABN provided → exact PK lookup. Cheap, deterministic.
//   2. Name provided (no ABN) → search_charities() RPC (trigram + ILIKE
//      prefix). The top result is the candidate; if its similarity score
//      is < 1.0 (i.e. not an exact match) but ≥ TYPOSQUAT_SIMILARITY_THRESHOLD
//      AND the Levenshtein edit distance to the nearest match is ≤
//      TYPOSQUAT_LEVENSHTEIN_MAX, we flag a potential typosquat /
//      impersonation in detail.typosquat_match.
//
// Two-signal calibration (v0.2a) — the v0.1 single-threshold approach
// (sim ≥ 0.85) almost never fired because real-world spoofs hit 0.42-0.60
// trigram similarity. Lowering the trigram threshold alone would create
// false positives ("Cancer Foundation" colliding with anything cancer-
// adjacent), so we AND it with a Levenshtein edit distance gate. The
// combination catches genuine typo/letter-swap impersonations
// ("Astralian Red Cross" → "Australian Red Cross", 1 edit) without
// flagging legitimately-different charities sharing keywords.
//
// Risk mapping (0..100, higher = more risk):
//   * Exact match, registered                       →  0   (SAFE pillar)
//   * Near-miss meeting BOTH typosquat conditions   → 100  (HIGH_RISK floor)
//   * Near-miss not meeting both                    → 100  (SUSPICIOUS, no floor)
//   * No match found                                → 100  (SUSPICIOUS)
//   * RPC failure / Supabase down                   → unavailable (degraded)
//
// detail payload exposes:
//   - charity_legal_name, charity_website, town_city, state, charity_size
//   - typosquat_match (bool), nearest_match (string),
//     nearest_match_similarity (number), nearest_match_edit_distance (number)

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

const PROVIDER_ID = "acnc";

/** Minimum trigram similarity AND maximum Levenshtein distance to flag a
 *  name-only lookup as a typosquat match. Both must hold (AND), not either
 *  (OR) — see the file header for the calibration rationale.
 *
 *  Trigram threshold lowered from v0.1's 0.85 to 0.65 because real-world
 *  spoofs (verified against the live 63k-row register on 2026-05-02) cluster
 *  in the 0.42-0.60 range; the Levenshtein gate is what stops false
 *  positives from creeping in below 0.85. */
const TYPOSQUAT_SIMILARITY_THRESHOLD = 0.65;
const TYPOSQUAT_LEVENSHTEIN_MAX = 3;

interface SearchCharitiesRow {
  abn: string;
  charity_legal_name: string;
  town_city: string | null;
  state: string | null;
  charity_website: string | null;
  similarity_score: number;
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
  timeoutMs: 2000,
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
          // ABN not present in the register. The ABR pillar will still
          // resolve the entity (or confirm cancelled) — this pillar just
          // reports "not registered as a charity".
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

      // Path 2: name only — trigram search via the search_charities RPC.
      if (input.name) {
        const { data, error } = await supa.rpc("search_charities", {
          p_query: input.name,
          p_limit: 5,
        });

        if (error) {
          logger.warn("acnc search_charities RPC failed", { error: String(error.message) });
          return unavailablePillar("acnc_registration", "rpc_error");
        }

        const rows = (data ?? []) as SearchCharitiesRow[];
        const top = rows[0];

        if (!top) {
          // No match at all — couldn't surface even a near-miss.
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

        const isExact =
          top.similarity_score >= 1.0 ||
          top.charity_legal_name.toLowerCase().trim() === input.name.toLowerCase().trim();

        if (isExact) {
          return {
            id: "acnc_registration",
            score: 0,
            confidence: 1,
            available: true,
            detail: {
              registered: true,
              charity_legal_name: top.charity_legal_name,
              charity_website: top.charity_website,
              town_city: top.town_city,
              state: top.state,
              abn: top.abn,
              typosquat_match: false,
            },
          };
        }

        // Near-miss but not exact: check BOTH trigram similarity AND
        // Levenshtein edit distance. Both must clear their thresholds
        // for typosquat_match=true (which the scorer floor escalates to
        // HIGH_RISK). Either alone is too permissive.
        const editDistance = levenshtein(
          input.name.toLowerCase().trim(),
          top.charity_legal_name.toLowerCase().trim(),
        );
        const typosquatMatch =
          top.similarity_score >= TYPOSQUAT_SIMILARITY_THRESHOLD &&
          editDistance <= TYPOSQUAT_LEVENSHTEIN_MAX;
        return {
          id: "acnc_registration",
          score: 100,
          confidence: typosquatMatch ? 0.9 : 0.6,
          available: true,
          detail: {
            registered: false,
            reason: typosquatMatch ? "typosquat_near_match" : "no_exact_name_match",
            nearest_match: top.charity_legal_name,
            nearest_match_abn: top.abn,
            nearest_match_similarity: top.similarity_score,
            nearest_match_edit_distance: editDistance,
            typosquat_match: typosquatMatch,
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

  // Always iterate over the shorter string for the rolling row to keep
  // memory bounded.
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
        curr[i - 1] + 1, // insertion
        prev[i] + 1, // deletion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}
