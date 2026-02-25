export interface ExtensionURLCheckResponse {
  found: boolean;
  threatLevel?: "LOW" | "MEDIUM" | "HIGH";
  reportCount?: number;
  domain?: string;
  safeBrowsing?: { isMalicious: boolean; sources: string[] };
  redirect?: { finalUrl: string; hopCount: number; isShortened: boolean };
}
