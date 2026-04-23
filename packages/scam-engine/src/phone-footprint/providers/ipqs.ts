// Provider 3b/5: IPQualityScore phone — reputation fallback for pillar 3.
//
// When Vonage is disabled or returns `available: false` for the reputation
// leg, we use IPQS's fraud_score as the pillar-3 source at 0.7 confidence.
// The orchestrator decides which of the two is primary based on Vonage's
// return value; here we just run IPQS unconditionally (still cheap at
// ~$0.003/call) and let the scorer pick.

import { checkIPQS } from "../../ipqualityscore";
import { logger } from "@askarthur/utils/logger";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";

export const ipqsProvider: ProviderContract = {
  id: "ipqs-phone",
  timeoutMs: 2000,

  async run(msisdn: string): Promise<PillarResult> {
    if (!process.env.IPQUALITYSCORE_API_KEY) {
      return unavailablePillar("reputation", "ipqs_key_missing");
    }
    try {
      const r = await checkIPQS(msisdn);
      // IPQS returns EMPTY_RESULT on errors; detect by valid=false +
      // fraudScore=0 as a proxy.
      if (!r.valid && r.fraudScore === 0 && !r.carrier) {
        return unavailablePillar("reputation", "ipqs_empty");
      }
      return {
        id: "reputation",
        score: r.fraudScore,
        confidence: 0.7,
        available: true,
        detail: {
          source: "ipqs",
          fraud_score: r.fraudScore,
          valid: r.valid,
          active: r.active,
          line_type: r.lineType,
          carrier: r.carrier,
          country: r.country,
          risky: r.risky,
          recent_abuse: r.recentAbuse,
          leaked: r.leaked,
          prepaid: r.prepaid,
          do_not_call: r.doNotCall,
        },
      };
    } catch (err) {
      logger.warn("ipqs provider failed", { error: String(err) });
      return unavailablePillar("reputation", "ipqs_error");
    }
  },
};
