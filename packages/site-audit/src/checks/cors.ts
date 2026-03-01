// CORS check: flag overly permissive Access-Control-Allow-Origin

import type { CheckResult } from "../types";

/** Check CORS Access-Control-Allow-Origin header */
export function checkCORS(headers: Headers): CheckResult {
  const value = headers.get("access-control-allow-origin");

  if (!value) {
    return {
      id: "cors",
      category: "headers",
      label: "CORS Policy",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: "No Access-Control-Allow-Origin header present. Cross-origin requests are restricted by default.",
    };
  }

  if (value === "*") {
    return {
      id: "cors",
      category: "headers",
      label: "CORS Policy",
      status: "warn",
      score: 1,
      maxScore: 3,
      details:
        "Access-Control-Allow-Origin is set to wildcard (*). Any origin can make cross-origin requests.",
    };
  }

  return {
    id: "cors",
    category: "headers",
    label: "CORS Policy",
    status: "pass",
    score: 3,
    maxScore: 3,
    details: `Access-Control-Allow-Origin is restricted to ${value}.`,
  };
}
