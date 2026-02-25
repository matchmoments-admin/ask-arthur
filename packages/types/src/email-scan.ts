import type { Verdict } from "./analysis";

export interface EmailContent {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  links: string[];
  timestamp?: number;
}

export interface EmailScanResult {
  messageId: string;
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  scamType?: string;
  impersonatedBrand?: string;
  scannedAt: number;
}
