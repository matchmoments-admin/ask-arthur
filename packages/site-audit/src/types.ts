// Site audit scanner types — internal to @askarthur/site-audit

export type SecurityGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export type CheckStatus = "pass" | "warn" | "fail" | "error" | "skipped";

export type CheckCategory =
  | "https"
  | "headers"
  | "csp"
  | "permissions"
  | "server"
  | "content"
  | "email";

export interface CheckResult {
  id: string;
  category: CheckCategory;
  label: string;
  status: CheckStatus;
  score: number;
  maxScore: number;
  details: string;
}

export interface CategoryScore {
  category: CheckCategory;
  label: string;
  score: number;
  maxScore: number;
  grade: SecurityGrade;
  checks: CheckResult[];
}

export interface SSLInfo {
  valid: boolean;
  issuer: string | null;
  daysRemaining: number | null;
  validFrom: string | null;
  validTo: string | null;
  protocol: string | null;
  cipher: string | null;
}

export interface ServerInfo {
  raw: string | null;
  software: string | null;
  version: string | null;
  isDisclosed: boolean;
}

export interface PermissionDirective {
  feature: string;
  allowlist: string[];
  isRestricted: boolean;
}

export interface RedirectHop {
  url: string;
  statusCode: number;
  server?: string;
  location?: string;
}

export interface SiteAuditResult {
  url: string;
  domain: string;
  scannedAt: string;
  durationMs: number;
  overallScore: number;
  grade: SecurityGrade;
  categories: CategoryScore[];
  checks: CheckResult[];
  recommendations: string[];
  ssl: SSLInfo | null;
  serverInfo: ServerInfo | null;
  redirectChain: RedirectHop[] | null;
}

export interface ScanOptions {
  url: string;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  userAgent?: string;
  skipChecks?: string[];
}
