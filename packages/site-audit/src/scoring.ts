// Scoring engine — category weights, grade thresholds, recommendation generator

import type {
  CheckResult,
  CategoryScore,
  CheckCategory,
  SecurityGrade,
} from "./types";

// Category configuration: weights must sum to 1.0
const CATEGORY_CONFIG: Record<
  CheckCategory,
  { label: string; weight: number }
> = {
  https: { label: "HTTPS & TLS", weight: 0.27 },
  headers: { label: "Security Headers", weight: 0.23 },
  csp: { label: "Content Security Policy", weight: 0.18 },
  permissions: { label: "Permissions Policy", weight: 0.09 },
  server: { label: "Server Security", weight: 0.09 },
  content: { label: "Content Security", weight: 0.06 },
  email: { label: "Email Security", weight: 0.08 },
};

// Grade thresholds (percentage score 0-100)
const GRADE_THRESHOLDS: Array<{ min: number; grade: SecurityGrade }> = [
  { min: 95, grade: "A+" },
  { min: 80, grade: "A" },
  { min: 65, grade: "B" },
  { min: 50, grade: "C" },
  { min: 35, grade: "D" },
  { min: 0, grade: "F" },
];

// Recommendation templates keyed by check ID
const RECOMMENDATIONS: Record<string, string> = {
  hsts: "Add a Strict-Transport-Security header with max-age=31536000 and includeSubDomains.",
  "x-content-type-options": "Add X-Content-Type-Options: nosniff to prevent MIME-sniffing attacks.",
  "x-frame-options": "Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking.",
  "referrer-policy": "Set Referrer-Policy to strict-origin-when-cross-origin or stricter.",
  "csp-present": "Implement a Content-Security-Policy header with at least default-src and script-src directives.",
  "csp-unsafe-inline": "Remove 'unsafe-inline' from CSP and use nonces or hashes for inline scripts.",
  "csp-unsafe-eval": "Remove 'unsafe-eval' from CSP to prevent dynamic code execution via eval().",
  "permissions-policy": "Add a Permissions-Policy header restricting camera, microphone, geolocation, and payment.",
  "tls-1.2": "Enable TLS 1.2 support — this is the minimum recommended TLS version.",
  "tls-1.3": "Enable TLS 1.3 for improved security and performance.",
  "tls-1.0-absent": "Disable TLS 1.0 — it has known vulnerabilities and is deprecated.",
  "tls-1.1-absent": "Disable TLS 1.1 — it is deprecated and should not be used.",
  "ssl-certificate": "Install a valid SSL certificate and ensure it is not expired.",
  "mixed-content": "Update all resource URLs to use HTTPS instead of HTTP.",
  "admin-paths": "Restrict access to admin and sensitive paths using IP allowlists or authentication.",
  "server-info": "Remove or hide the Server header to prevent version disclosure.",
  spf: "Add an SPF record (TXT v=spf1) to prevent email spoofing from your domain.",
  dmarc: 'Add a DMARC record with p=reject at _dmarc.yourdomain.com to block spoofed emails.',
  dkim: "Configure DKIM signing for your email to authenticate outgoing messages.",
  "domain-blacklist": "Your domain is listed on one or more DNS blacklists. Investigate and request removal.",
  "redirect-chain": "Reduce the number of redirects in your URL chain. Excessive redirects slow page loads and may indicate URL obfuscation.",
  coep: "Add a Cross-Origin-Embedder-Policy header (require-corp or credentialless) to enable cross-origin isolation.",
  coop: "Add a Cross-Origin-Opener-Policy: same-origin header to isolate your browsing context from cross-origin windows.",
  corp: "Add a Cross-Origin-Resource-Policy: same-origin header to prevent your resources from being loaded by other origins.",
  cors: "Restrict Access-Control-Allow-Origin to specific trusted origins instead of using wildcard (*).",
};

/** Calculate grade from a percentage score (0-100) */
export function calculateGrade(score: number): SecurityGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

/** Group checks by category and calculate category scores */
export function calculateCategoryScores(
  checks: CheckResult[]
): CategoryScore[] {
  const grouped = new Map<CheckCategory, CheckResult[]>();

  for (const check of checks) {
    const existing = grouped.get(check.category) || [];
    existing.push(check);
    grouped.set(check.category, existing);
  }

  const categories: CategoryScore[] = [];

  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    const cat = category as CheckCategory;
    const catChecks = grouped.get(cat) || [];

    const score = catChecks.reduce((sum, c) => sum + c.score, 0);
    const maxScore = catChecks.reduce((sum, c) => sum + c.maxScore, 0);
    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

    categories.push({
      category: cat,
      label: config.label,
      score,
      maxScore,
      grade: calculateGrade(percentage),
      checks: catChecks,
    });
  }

  return categories;
}

/** Calculate overall weighted score (0-100) from category scores */
export function calculateScore(categories: CategoryScore[]): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const cat of categories) {
    const config = CATEGORY_CONFIG[cat.category];
    if (!config || cat.maxScore === 0) continue;

    const categoryPercent = cat.score / cat.maxScore;
    weightedSum += categoryPercent * config.weight;
    totalWeight += config.weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100);
}

/** Generate recommendations from failed/warned checks */
export function generateRecommendations(checks: CheckResult[]): string[] {
  const recs: string[] = [];

  // Sort by impact: fail first, then warn
  const actionable = checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => {
      if (a.status === "fail" && b.status !== "fail") return -1;
      if (a.status !== "fail" && b.status === "fail") return 1;
      return b.maxScore - a.maxScore; // Higher impact first
    });

  for (const check of actionable) {
    const rec = RECOMMENDATIONS[check.id];
    if (rec && !recs.includes(rec)) {
      recs.push(rec);
    }
  }

  return recs;
}
