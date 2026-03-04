export type ExtensionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ExtensionRiskFactor {
  id: string;
  label: string;
  severity: ExtensionRiskLevel;
  description: string;
}

export interface ExtensionScanResult {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installType: string;
  permissions: string[];
  hostPermissions: string[];
  riskLevel: ExtensionRiskLevel;
  riskScore: number;
  riskFactors: ExtensionRiskFactor[];
  isKnownMalicious: boolean;
  iconUrl?: string;
  homepageUrl?: string;
}

export interface ExtensionSecurityReport {
  scannedAt: number;
  totalExtensions: number;
  enabledExtensions: number;
  riskBreakdown: Record<ExtensionRiskLevel, number>;
  extensions: ExtensionScanResult[];
  overallRiskLevel: ExtensionRiskLevel;
}

export interface CRXAnalysisResult {
  extensionId: string;
  contentScripts?: { matches: string[]; js?: string[] }[];
  csp?: string;
  webAccessibleResources?: string[];
  additionalRiskFactors: ExtensionRiskFactor[];
}

export interface ExtensionAnalyzeRequest {
  extensions: Array<{
    id: string;
    name: string;
    version: string;
  }>;
}

export interface ExtensionAnalyzeResponse {
  results: CRXAnalysisResult[];
}
