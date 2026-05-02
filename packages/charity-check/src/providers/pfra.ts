// PFRA membership pillar — Postgres lookup against the local mirror
// (pfra_members, populated by pipeline/scrapers/pfra_members.py).
//
// PFRA membership is the strongest single signal that a face-to-face /
// door-knock fundraiser is legitimate. But not all legitimate charities
// are PFRA members (PFRA covers F2F only; many charities never join).
// So this pillar is ADDITIVE-ONLY:
//   * member found  → score 0  (positive signal, contributes to SAFE)
//   * not found     → available: false  (no penalty; scorer redistributes)
//   * RPC failure   → available: false  (degraded; scorer redistributes)
//
// Calls the lookup_pfra_member(p_abn, p_name) RPC introduced in v85.
// Prefers ABN-match (deterministic) over name-match (best-effort) when
// both are available; falls back to name-only lookup when no ABN.

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

interface LookupRow {
  name: string;
  member_type: "charity" | "agency";
  abn: string | null;
  source_url: string;
}

export const pfraProvider: CharityProviderContract = {
  id: "pfra",
  timeoutMs: 1500,
  async run(input: CharityCheckInput): Promise<CharityPillarResult> {
    if (!input.abn && !input.name) {
      return unavailablePillar("pfra", "no_query_input");
    }

    const supa = createServiceClient();
    if (!supa) {
      return unavailablePillar("pfra", "supabase_client_unavailable");
    }

    try {
      const { data, error } = await supa.rpc("lookup_pfra_member", {
        p_abn: input.abn ?? null,
        p_name: input.name ?? null,
      });

      if (error) {
        logger.warn("pfra lookup_pfra_member RPC failed", { error: String(error.message) });
        return unavailablePillar("pfra", "rpc_error");
      }

      const rows = (data ?? []) as LookupRow[];
      if (rows.length === 0) {
        // No PFRA membership found — report unavailable so the scorer
        // doesn't penalise. Most legit charities aren't PFRA members.
        return unavailablePillar("pfra", "not_a_member");
      }

      // Prefer charity-row over agency-row when both surface (the input
      // is a charity name; an agency match here would be a false positive
      // unless the user typed an agency name). RPC orders charity first.
      const top = rows[0]!;

      return {
        id: "pfra",
        score: 0, // additive positive signal — never raises risk
        confidence: 1,
        available: true,
        detail: {
          name: top.name,
          member_type: top.member_type,
          abn: top.abn,
          source_url: top.source_url,
          // Surface the count so the UI can hint when the input matched
          // both a charity AND an agency (rare but possible — agency
          // doing fundraising on behalf of a charity with the same name).
          match_count: rows.length,
        },
      };
    } catch (err) {
      logger.warn("pfra provider threw", { error: String(err) });
      return unavailablePillar("pfra", "exception");
    }
  },
};
