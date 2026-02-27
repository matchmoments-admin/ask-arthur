// Content Security Policy analysis — check existence + parse directives

import type { CheckResult } from "../types";

/** Parse a CSP header into directive map */
function parseCSP(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [directive, ...values] = trimmed.split(/\s+/);
    directives.set(directive.toLowerCase(), values);
  }
  return directives;
}

/** Check if CSP header is present */
export function checkCSPPresent(headers: Headers): CheckResult {
  const value = headers.get("content-security-policy");

  if (!value) {
    return {
      id: "csp-present",
      category: "csp",
      label: "Content Security Policy",
      status: "fail",
      score: 0,
      maxScore: 10,
      details: "No Content-Security-Policy header found. The site has no XSS mitigation via CSP.",
    };
  }

  const directives = parseCSP(value);
  const hasDefaultSrc = directives.has("default-src");
  const hasScriptSrc = directives.has("script-src");

  if (hasDefaultSrc || hasScriptSrc) {
    return {
      id: "csp-present",
      category: "csp",
      label: "Content Security Policy",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: `CSP is configured with ${directives.size} directive${directives.size !== 1 ? "s" : ""}.`,
    };
  }

  return {
    id: "csp-present",
    category: "csp",
    label: "Content Security Policy",
    status: "warn",
    score: 5,
    maxScore: 10,
    details: "CSP exists but missing default-src or script-src directive.",
  };
}

/** Check if CSP contains unsafe-inline */
export function checkCSPUnsafeInline(headers: Headers): CheckResult {
  const value = headers.get("content-security-policy");

  if (!value) {
    return {
      id: "csp-unsafe-inline",
      category: "csp",
      label: "CSP unsafe-inline",
      status: "skipped",
      score: 0,
      maxScore: 5,
      details: "No CSP header to check for unsafe-inline.",
    };
  }

  const hasUnsafeInline = value.toLowerCase().includes("'unsafe-inline'");

  if (!hasUnsafeInline) {
    return {
      id: "csp-unsafe-inline",
      category: "csp",
      label: "CSP unsafe-inline",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: "CSP does not use unsafe-inline.",
    };
  }

  return {
    id: "csp-unsafe-inline",
    category: "csp",
    label: "CSP unsafe-inline",
    status: "warn",
    score: 0,
    maxScore: 5,
    details: "CSP allows 'unsafe-inline' which weakens XSS protection.",
  };
}

/** Check if CSP contains unsafe-eval */
export function checkCSPUnsafeEval(headers: Headers): CheckResult {
  const value = headers.get("content-security-policy");

  if (!value) {
    return {
      id: "csp-unsafe-eval",
      category: "csp",
      label: "CSP unsafe-eval",
      status: "skipped",
      score: 0,
      maxScore: 5,
      details: "No CSP header to check for unsafe-eval.",
    };
  }

  const hasUnsafeEval = value.toLowerCase().includes("'unsafe-eval'");

  if (!hasUnsafeEval) {
    return {
      id: "csp-unsafe-eval",
      category: "csp",
      label: "CSP unsafe-eval",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: "CSP does not use unsafe-eval.",
    };
  }

  return {
    id: "csp-unsafe-eval",
    category: "csp",
    label: "CSP unsafe-eval",
    status: "fail",
    score: 0,
    maxScore: 5,
    details: "CSP allows 'unsafe-eval' which permits arbitrary code execution via eval().",
  };
}

/** Run all CSP checks */
export function checkCSP(headers: Headers): CheckResult[] {
  return [
    checkCSPPresent(headers),
    checkCSPUnsafeInline(headers),
    checkCSPUnsafeEval(headers),
  ];
}
