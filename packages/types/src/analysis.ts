export const PROMPT_VERSION = "2.0.0";

export type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";
export type AnalysisMode = "text" | "image" | "qrcode";

export interface ScammerContact {
  value: string;
  context: string;
}

export interface ScammerContacts {
  phoneNumbers: ScammerContact[];
  emailAddresses: ScammerContact[];
}

export interface AnalysisResult {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  scamType?: string;
  impersonatedBrand?: string;
  channel?: string;
  scammerContacts?: ScammerContacts;
}

export interface InjectionCheckResult {
  detected: boolean;
  patterns: string[];
}
