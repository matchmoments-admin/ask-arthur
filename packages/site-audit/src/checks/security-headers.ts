// Security header checks: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy

import type { CheckResult } from "../types";

/** Check Strict-Transport-Security header */
export function checkHSTS(headers: Headers): CheckResult {
  const value = headers.get("strict-transport-security");

  if (!value) {
    return {
      id: "hsts",
      category: "headers",
      label: "Strict-Transport-Security",
      status: "fail",
      score: 0,
      maxScore: 15,
      details: "HSTS header is missing. Browsers may allow HTTP connections.",
    };
  }

  const maxAgeMatch = value.match(/max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0;
  const hasIncludeSub = /includeSubDomains/i.test(value);
  const hasPreload = /preload/i.test(value);

  // Full score: max-age >= 1 year + includeSubDomains
  if (maxAge >= 31_536_000 && hasIncludeSub) {
    return {
      id: "hsts",
      category: "headers",
      label: "Strict-Transport-Security",
      status: "pass",
      score: 15,
      maxScore: 15,
      details: `HSTS enabled with max-age=${maxAge}${hasIncludeSub ? ", includeSubDomains" : ""}${hasPreload ? ", preload" : ""}.`,
    };
  }

  // Partial: header present but weak config
  const score = maxAge >= 31_536_000 ? 10 : maxAge >= 86_400 ? 7 : 3;
  const issues: string[] = [];
  if (maxAge < 31_536_000) issues.push(`max-age is ${maxAge} (recommended: 31536000+)`);
  if (!hasIncludeSub) issues.push("missing includeSubDomains");

  return {
    id: "hsts",
    category: "headers",
    label: "Strict-Transport-Security",
    status: "warn",
    score,
    maxScore: 15,
    details: `HSTS configured but ${issues.join(", ")}.`,
  };
}

/** Check X-Content-Type-Options header */
export function checkXContentTypeOptions(headers: Headers): CheckResult {
  const value = headers.get("x-content-type-options");

  if (value?.toLowerCase() === "nosniff") {
    return {
      id: "x-content-type-options",
      category: "headers",
      label: "X-Content-Type-Options",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: "X-Content-Type-Options is set to nosniff.",
    };
  }

  return {
    id: "x-content-type-options",
    category: "headers",
    label: "X-Content-Type-Options",
    status: "fail",
    score: 0,
    maxScore: 5,
    details: value
      ? `X-Content-Type-Options is set to "${value}" (expected: nosniff).`
      : "X-Content-Type-Options header is missing. Browser may MIME-sniff responses.",
  };
}

/** Check X-Frame-Options header */
export function checkXFrameOptions(headers: Headers): CheckResult {
  const value = headers.get("x-frame-options")?.toUpperCase();

  if (value === "DENY" || value === "SAMEORIGIN") {
    return {
      id: "x-frame-options",
      category: "headers",
      label: "X-Frame-Options",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: `X-Frame-Options is set to ${value}.`,
    };
  }

  return {
    id: "x-frame-options",
    category: "headers",
    label: "X-Frame-Options",
    status: "fail",
    score: 0,
    maxScore: 5,
    details: value
      ? `X-Frame-Options is set to "${value}" (expected: DENY or SAMEORIGIN).`
      : "X-Frame-Options header is missing. Page may be embedded in iframes (clickjacking risk).",
  };
}

/** Check Referrer-Policy header */
export function checkReferrerPolicy(headers: Headers): CheckResult {
  const value = headers.get("referrer-policy")?.toLowerCase();

  const restrictive = [
    "no-referrer",
    "same-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
  ];

  if (value && restrictive.includes(value)) {
    return {
      id: "referrer-policy",
      category: "headers",
      label: "Referrer-Policy",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: `Referrer-Policy is set to ${value}.`,
    };
  }

  if (value) {
    return {
      id: "referrer-policy",
      category: "headers",
      label: "Referrer-Policy",
      status: "warn",
      score: 2,
      maxScore: 5,
      details: `Referrer-Policy is set to "${value}" which may leak URL information.`,
    };
  }

  return {
    id: "referrer-policy",
    category: "headers",
    label: "Referrer-Policy",
    status: "fail",
    score: 0,
    maxScore: 5,
    details: "Referrer-Policy header is missing. Full URLs may be sent in referrer headers.",
  };
}

/** Check Cache-Control header */
export function checkCacheControl(headers: Headers): CheckResult {
  const value = headers.get("cache-control")?.toLowerCase();

  if (!value) {
    return {
      id: "cache-control",
      category: "headers",
      label: "Cache-Control",
      status: "warn",
      score: 1,
      maxScore: 3,
      details: "Cache-Control header is missing. Sensitive responses may be cached by intermediaries.",
    };
  }

  if (value.includes("no-store") || value.includes("private")) {
    return {
      id: "cache-control",
      category: "headers",
      label: "Cache-Control",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: `Cache-Control is set to "${headers.get("cache-control")}".`,
    };
  }

  return {
    id: "cache-control",
    category: "headers",
    label: "Cache-Control",
    status: "warn",
    score: 1,
    maxScore: 3,
    details: `Cache-Control is "${headers.get("cache-control")}" but does not include no-store or private. Sensitive pages may be cached.`,
  };
}

/** Run all security header checks */
export function checkSecurityHeaders(headers: Headers): CheckResult[] {
  return [
    checkHSTS(headers),
    checkXContentTypeOptions(headers),
    checkXFrameOptions(headers),
    checkReferrerPolicy(headers),
    checkCacheControl(headers),
  ];
}
