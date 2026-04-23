// Provider 5/5: Twilio Lookup v2 — line type + CNAM.
//
// Feeds pillar 5 (identity & line attributes). Reuses the existing
// twilio-lookup.ts primitive verbatim (24h Redis cache, $0.018/call
// instrumented via logCost from the caller). The existing
// computePhoneRiskScore() already produces a 0-100 risk score from
// line_type + VoIP + carrier + CNAM; we pass that through directly as the
// pillar score but mark confidence 0.7 because this pillar is the weakest
// signal in the composite.

import { lookupPhoneNumber } from "../../twilio-lookup";
import { logger } from "@askarthur/utils/logger";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";

export const twilioProvider: ProviderContract = {
  id: "twilio-lookup",
  timeoutMs: 2500,

  async run(msisdn: string): Promise<PillarResult> {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return unavailablePillar("identity", "twilio_credentials_missing");
    }

    try {
      const r = await lookupPhoneNumber(msisdn);
      // lookupPhoneNumber returns a degraded result on errors with
      // riskFlags: ['lookup_failed']; treat that as unavailable.
      if (r.riskFlags.includes("lookup_failed")) {
        return unavailablePillar("identity", "lookup_failed");
      }
      return {
        id: "identity",
        score: r.riskScore,
        confidence: 0.7,
        available: true,
        detail: {
          valid: r.valid,
          carrier: r.carrier,
          lineType: r.lineType,
          isVoip: r.isVoip,
          countryCode: r.countryCode,
          nationalFormat: r.nationalFormat,
          callerName: r.callerName,
          callerNameType: r.callerNameType,
          riskFlags: r.riskFlags,
        },
      };
    } catch (err) {
      logger.warn("twilio provider failed", { error: String(err) });
      return unavailablePillar("identity", "twilio_error");
    }
  },
};
