import type { ScammerContacts, PhoneLookupResult } from "@askarthur/types";

export type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

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
}
