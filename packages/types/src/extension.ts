export interface ExtensionURLCheckResponse {
  found: boolean;
  threatLevel?: "LOW" | "MEDIUM" | "HIGH";
  reportCount?: number;
  domain?: string;
  safeBrowsing?: { isMalicious: boolean; sources: string[] };
}
