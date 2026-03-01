// Cross-Origin header checks: COEP, COOP, CORP

import type { CheckResult } from "../types";

/** Check Cross-Origin-Embedder-Policy header */
export function checkCOEP(headers: Headers): CheckResult {
  const value = headers.get("cross-origin-embedder-policy")?.toLowerCase();

  if (!value) {
    return {
      id: "coep",
      category: "headers",
      label: "Cross-Origin-Embedder-Policy",
      status: "fail",
      score: 0,
      maxScore: 3,
      details:
        "Cross-Origin-Embedder-Policy header is missing. Site cannot enable cross-origin isolation.",
    };
  }

  if (value === "require-corp" || value === "credentialless") {
    return {
      id: "coep",
      category: "headers",
      label: "Cross-Origin-Embedder-Policy",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: `Cross-Origin-Embedder-Policy is set to ${value}.`,
    };
  }

  return {
    id: "coep",
    category: "headers",
    label: "Cross-Origin-Embedder-Policy",
    status: "warn",
    score: 1,
    maxScore: 3,
    details: `Cross-Origin-Embedder-Policy is set to "${value}" (expected: require-corp or credentialless).`,
  };
}

/** Check Cross-Origin-Opener-Policy header */
export function checkCOOP(headers: Headers): CheckResult {
  const value = headers.get("cross-origin-opener-policy")?.toLowerCase();

  if (!value) {
    return {
      id: "coop",
      category: "headers",
      label: "Cross-Origin-Opener-Policy",
      status: "fail",
      score: 0,
      maxScore: 3,
      details:
        "Cross-Origin-Opener-Policy header is missing. Page may be accessed by cross-origin windows.",
    };
  }

  if (value === "same-origin") {
    return {
      id: "coop",
      category: "headers",
      label: "Cross-Origin-Opener-Policy",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: "Cross-Origin-Opener-Policy is set to same-origin.",
    };
  }

  if (value === "same-origin-allow-popups") {
    return {
      id: "coop",
      category: "headers",
      label: "Cross-Origin-Opener-Policy",
      status: "warn",
      score: 2,
      maxScore: 3,
      details:
        "Cross-Origin-Opener-Policy is set to same-origin-allow-popups. Consider same-origin for full isolation.",
    };
  }

  return {
    id: "coop",
    category: "headers",
    label: "Cross-Origin-Opener-Policy",
    status: "fail",
    score: 0,
    maxScore: 3,
    details: `Cross-Origin-Opener-Policy is set to "${value}" (expected: same-origin).`,
  };
}

/** Check Cross-Origin-Resource-Policy header */
export function checkCORP(headers: Headers): CheckResult {
  const value = headers.get("cross-origin-resource-policy")?.toLowerCase();

  if (!value) {
    return {
      id: "corp",
      category: "headers",
      label: "Cross-Origin-Resource-Policy",
      status: "fail",
      score: 0,
      maxScore: 3,
      details:
        "Cross-Origin-Resource-Policy header is missing. Resources may be loaded by any origin.",
    };
  }

  if (value === "same-origin") {
    return {
      id: "corp",
      category: "headers",
      label: "Cross-Origin-Resource-Policy",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: "Cross-Origin-Resource-Policy is set to same-origin.",
    };
  }

  if (value === "same-site") {
    return {
      id: "corp",
      category: "headers",
      label: "Cross-Origin-Resource-Policy",
      status: "warn",
      score: 2,
      maxScore: 3,
      details:
        "Cross-Origin-Resource-Policy is set to same-site. Consider same-origin for stricter isolation.",
    };
  }

  if (value === "cross-origin") {
    return {
      id: "corp",
      category: "headers",
      label: "Cross-Origin-Resource-Policy",
      status: "warn",
      score: 1,
      maxScore: 3,
      details:
        "Cross-Origin-Resource-Policy is set to cross-origin. Resources can be loaded by any origin.",
    };
  }

  return {
    id: "corp",
    category: "headers",
    label: "Cross-Origin-Resource-Policy",
    status: "warn",
    score: 1,
    maxScore: 3,
    details: `Cross-Origin-Resource-Policy is set to "${value}" (expected: same-origin, same-site, or cross-origin).`,
  };
}

/** Run all cross-origin header checks */
export function checkCrossOriginHeaders(headers: Headers): CheckResult[] {
  return [checkCOEP(headers), checkCOOP(headers), checkCORP(headers)];
}
