// ACNC Charity Register pillar — Postgres lookup against the local mirror
// (acnc_charities, populated by pipeline/scrapers/acnc_register.py).
//
// Two query paths:
//   1. ABN provided → exact PK lookup. Cheap, deterministic.
//   2. Name provided (no ABN) → search_charities() RPC (trigram + ILIKE
//      prefix). The top result is the candidate; if its similarity score
//      is < 1.0 (i.e. not an exact match) but >= 0.85, we flag a
//      potential typosquat / impersonation in detail.typosquat_match.
//
// Risk mapping (0..100, higher = more risk):
//   * Exact match, registered                      →  0   (SAFE pillar)
//   * Match by name, similarity 0.85..0.99         → 100  (typosquat hard-floor)
//   * No match found                               → 100  (SUSPICIOUS upstream)
//   * RPC failure / Supabase down                  → unavailable (degraded)
//
// detail payload exposes:
//   - charity_legal_name, charity_website, town_city, state, charity_size
//   - typosquat_match (bool), nearest_match (string)
// The route may redact some of this for non-paid tiers in v0.2; v0.1
// returns it all.

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

const PROVIDER_ID = "acnc";

/** Minimum trigram similarity to flag a name-only lookup as a typosquat
 *  match. Calibrated empirically: < 0.85 produces too many false positives
 *  on common words ("Cancer Foundation"); ≥ 1.0 means an exact match
 *  (handled separately as SAFE). */
const TYPOSQUAT_SIMILARITY_THRESHOLD = 0.85;

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

        // Near-miss but not exact: typosquat-like impersonation pattern.
        // The scorer's hard-floor rule will escalate this to HIGH_RISK
        // even though the score itself is what triggers it visually.
        const typosquatMatch = top.similarity_score >= TYPOSQUAT_SIMILARITY_THRESHOLD;
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
