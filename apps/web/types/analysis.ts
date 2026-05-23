import type { ScammerContacts, PhoneLookupResult, ShopSignal, Verdict } from "@askarthur/types";

export type { Verdict };

export interface ScammerUrl {
  url: string;
  isMalicious: boolean;
  sources: string[];
}

export interface AnalysisResponse {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  scammerContacts?: ScammerContacts;
  scammerUrls?: ScammerUrl[];
  inputMode?: string;
  scamType?: string;
  impersonatedBrand?: string;
  channel?: string;
  phoneRiskFlags?: string[];
  isVoipCaller?: boolean;
  phoneIntelligence?: PhoneLookupResult;
  /** v0.2e — present when the input looked charity-shaped. Drives the
   *  "Run a full charity check →" CTA above the verdict in ResultCard. */
  charityIntent?: {
    detected: true;
    extractedAbn?: string;
    extractedName?: string;
  };
  /** Shop Guard Stage 0 — present when the input looked commerce-shaped.
   *  Drives the commerce-flag chip row under the verdict in ResultCard.
   *  Plan: docs/plans/shop-guard-v2.md. */
  shopSignal?: ShopSignal;
}
