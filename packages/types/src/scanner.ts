// Unified security scanner types — shared across all scan engines

export type ScanType = "website" | "extension" | "mcp-server" | "skill";

export type SecurityGrade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F";

export type CheckStatus = "pass" | "warn" | "fail" | "error" | "skipped";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface ScanCheck {
  id: string;
  category: string;
  label: string;
  status: CheckStatus;
  score: number;
  maxScore: number;
  details: string;
  severity?: Severity;
  /** OWASP or standard reference (e.g. "MCP03", "EXT-010") */
  reference?: string;
  /** Matched text that triggered the check (for evidence display) */
  evidence?: string;
}

export interface ScanCategory {
  category: string;
  label: string;
  weight: number;
  score: number;
  maxScore: number;
  grade: SecurityGrade;
  checks: ScanCheck[];
}

export interface ScanRecommendation {
  text: string;
  severity: Severity;
  snippet?: string;
  /** Link to learn more */
  learnMoreUrl?: string;
}

export interface UnifiedScanResult {
  type: ScanType;
  target: string;
  targetDisplay: string;
  scannedAt: string;
  durationMs: number;
  overallScore: number;
  grade: SecurityGrade;
  categories: ScanCategory[];
  checks: ScanCheck[];
  recommendations: ScanRecommendation[];
  shareToken: string;
  autoFailTriggered: boolean;
  autoFailReason?: string;
  /** Scan-type-specific metadata */
  meta?: Record<string, unknown>;
}

export type ScanVisibility = "public" | "unlisted" | "private";

export interface StoredScanResult {
  id: number;
  scan_type: ScanType;
  target: string;
  target_display: string | null;
  overall_score: number;
  grade: string;
  result: UnifiedScanResult;
  share_token: string;
  visibility: ScanVisibility;
  scanned_at: string;
}

// Grade thresholds — identical across all scan types
export const GRADE_THRESHOLDS: Array<{ min: number; grade: SecurityGrade }> = [
  { min: 97, grade: "A+" },
  { min: 93, grade: "A" },
  { min: 90, grade: "A-" },
  { min: 85, grade: "B+" },
  { min: 80, grade: "B" },
  { min: 75, grade: "B-" },
  { min: 70, grade: "C+" },
  { min: 65, grade: "C" },
  { min: 60, grade: "C-" },
  { min: 50, grade: "D" },
  { min: 0, grade: "F" },
];

export function calculateGrade(score: number): SecurityGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

/** Grade color mapping for UI rendering */
export const GRADE_COLORS: Record<SecurityGrade, { bg: string; text: string; border: string }> = {
  "A+": { bg: "#ECFDF5", text: "#166534", border: "#22C55E" },
  "A":  { bg: "#ECFDF5", text: "#166534", border: "#22C55E" },
  "A-": { bg: "#ECFDF5", text: "#166534", border: "#4ADE80" },
  "B+": { bg: "#F0FDF4", text: "#15803D", border: "#86EFAC" },
  "B":  { bg: "#F0FDF4", text: "#15803D", border: "#86EFAC" },
  "B-": { bg: "#FEFCE8", text: "#854D0E", border: "#FDE047" },
  "C+": { bg: "#FFFBEB", text: "#92400E", border: "#FBBF24" },
  "C":  { bg: "#FFF7ED", text: "#9A3412", border: "#FB923C" },
  "C-": { bg: "#FFF7ED", text: "#9A3412", border: "#FB923C" },
  "D":  { bg: "#FEF2F2", text: "#991B1B", border: "#F87171" },
  "F":  { bg: "#FEF2F2", text: "#991B1B", border: "#EF4444" },
};
