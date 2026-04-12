export const PROMPT_VERSION = "2.0.0";

export type Verdict = "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK";
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
  redirects?: RedirectChain[];
  phoneIntelligence?: PhoneLookupResult;
}

export interface InjectionCheckResult {
  detected: boolean;
  patterns: string[];
}

export type PhoneRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PhoneLookupResult {
  valid: boolean;
  phoneNumber: string;
  countryCode: string | null;
  nationalFormat: string | null;
  lineType: string | null;
  carrier: string | null;
  isVoip: boolean;
  riskFlags: string[];
  riskScore: number;
  riskLevel: PhoneRiskLevel;
  callerName: string | null;
  callerNameType: string | null;
}

export interface RedirectHop {
  url: string;
  statusCode: number;
  latencyMs: number;
}

export interface RedirectChain {
  originalUrl: string;
  finalUrl: string;
  hops: RedirectHop[];
  hopCount: number;
  isShortened: boolean;
  hasOpenRedirect: boolean;
  truncated: boolean;
  error?: string;
}
