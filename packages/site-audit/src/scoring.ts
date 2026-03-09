// Scoring engine — category weights, grade thresholds, recommendation generator

import type {
  CheckResult,
  CategoryScore,
  CheckCategory,
  SecurityGrade,
  Recommendation,
  Severity,
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
const RECOMMENDATIONS: Record<string, Recommendation> = {
  hsts: {
    text: "Add a Strict-Transport-Security header with max-age=31536000 and includeSubDomains.",
    severity: "high",
    snippet: `# nginx\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n\n# Apache\nHeader always set Strict-Transport-Security "max-age=31536000; includeSubDomains"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }] }] }`,
  },
  "x-content-type-options": {
    text: "Add X-Content-Type-Options: nosniff to prevent MIME-sniffing attacks.",
    severity: "low",
    snippet: `# nginx\nadd_header X-Content-Type-Options "nosniff" always;\n\n# Apache\nHeader always set X-Content-Type-Options "nosniff"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "X-Content-Type-Options", "value": "nosniff" }] }] }`,
  },
  "x-frame-options": {
    text: "Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking.",
    severity: "medium",
    snippet: `# nginx\nadd_header X-Frame-Options "DENY" always;\n\n# Apache\nHeader always set X-Frame-Options "DENY"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "X-Frame-Options", "value": "DENY" }] }] }`,
  },
  "referrer-policy": {
    text: "Set Referrer-Policy to strict-origin-when-cross-origin or stricter.",
    severity: "medium",
    snippet: `# nginx\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\n# Apache\nHeader always set Referrer-Policy "strict-origin-when-cross-origin"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }] }] }`,
  },
  "csp-present": {
    text: "Implement a Content-Security-Policy header with at least default-src and script-src directives.",
    severity: "high",
    snippet: `# nginx\nadd_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" always;\n\n# Apache\nHeader always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'" }] }] }`,
  },
  "csp-unsafe-inline": {
    text: "Remove 'unsafe-inline' from CSP and use nonces or hashes for inline scripts.",
    severity: "medium",
  },
  "csp-unsafe-eval": {
    text: "Remove 'unsafe-eval' from CSP to prevent dynamic code execution via eval().",
    severity: "high",
  },
  "permissions-policy": {
    text: "Add a Permissions-Policy header restricting camera, microphone, geolocation, and payment.",
    severity: "medium",
    snippet: `# nginx\nadd_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;\n\n# Apache\nHeader always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }] }] }`,
  },
  "tls-1.2": {
    text: "Enable TLS 1.2 support — this is the minimum recommended TLS version.",
    severity: "high",
  },
  "tls-1.3": {
    text: "Enable TLS 1.3 for improved security and performance.",
    severity: "low",
  },
  "tls-1.0-absent": {
    text: "Disable TLS 1.0 — it has known vulnerabilities and is deprecated.",
    severity: "critical",
  },
  "tls-1.1-absent": {
    text: "Disable TLS 1.1 — it is deprecated and should not be used.",
    severity: "critical",
  },
  "ssl-certificate": {
    text: "Install a valid SSL certificate and ensure it is not expired.",
    severity: "critical",
  },
  "mixed-content": {
    text: "Update all resource URLs to use HTTPS instead of HTTP.",
    severity: "high",
  },
  "admin-paths": {
    text: "Restrict access to admin and sensitive paths using IP allowlists or authentication.",
    severity: "critical",
  },
  "server-info": {
    text: "Remove or hide the Server header to prevent version disclosure.",
    severity: "medium",
  },
  spf: {
    text: "Add an SPF record (TXT v=spf1) to prevent email spoofing from your domain.",
    severity: "medium",
  },
  dmarc: {
    text: 'Add a DMARC record with p=reject at _dmarc.yourdomain.com to block spoofed emails.',
    severity: "medium",
  },
  dkim: {
    text: "Configure DKIM signing for your email to authenticate outgoing messages.",
    severity: "low",
  },
  "domain-blacklist": {
    text: "Your domain is listed on one or more DNS blacklists. Investigate and request removal.",
    severity: "low",
  },
  "redirect-chain": {
    text: "Reduce the number of redirects in your URL chain. Excessive redirects slow page loads and may indicate URL obfuscation.",
    severity: "low",
  },
  coep: {
    text: "Add a Cross-Origin-Embedder-Policy header (require-corp or credentialless) to enable cross-origin isolation.",
    severity: "low",
  },
  coop: {
    text: "Add a Cross-Origin-Opener-Policy: same-origin header to isolate your browsing context from cross-origin windows.",
    severity: "low",
  },
  corp: {
    text: "Add a Cross-Origin-Resource-Policy: same-origin header to prevent your resources from being loaded by other origins.",
    severity: "low",
  },
  cors: {
    text: "Restrict Access-Control-Allow-Origin to specific trusted origins instead of using wildcard (*).",
    severity: "low",
  },
  "cookie-security": {
    text: "Set Secure, HttpOnly, and SameSite flags on all cookies, especially session cookies.",
    severity: "high",
  },
  sri: {
    text: "Add integrity attributes to external scripts and stylesheets to prevent supply chain attacks.",
    severity: "medium",
  },
  "open-redirect": {
    text: "Fix open redirect vulnerabilities by validating redirect targets against a whitelist.",
    severity: "critical",
  },
  "cache-control": {
    text: "Add Cache-Control: no-store or private to prevent sensitive pages from being cached.",
    severity: "medium",
    snippet: `# nginx\nadd_header Cache-Control "no-store" always;\n\n# Apache\nHeader always set Cache-Control "no-store"\n\n# Vercel (vercel.json)\n{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Cache-Control", "value": "no-store" }] }] }`,
  },
  dnssec: {
    text: "Enable DNSSEC to protect against DNS spoofing attacks.",
    severity: "low",
  },
  "security-txt": {
    text: "Add a /.well-known/security.txt file (RFC 9116) with contact information for security researchers.",
    severity: "low",
  },
};

// Severity sort order (critical first)
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
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

/** Generate recommendations from failed/warned checks, sorted by severity */
export function generateRecommendations(checks: CheckResult[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const seen = new Set<string>();

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
    if (rec && !seen.has(check.id)) {
      seen.add(check.id);
      recs.push(rec);
    }
  }

  // Sort by severity (critical first)
  recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return recs;
}
