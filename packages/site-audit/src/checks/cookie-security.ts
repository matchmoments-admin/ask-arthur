// Cookie security check — validate Secure, HttpOnly, SameSite flags on Set-Cookie headers

import type { CheckResult } from "../types";

// Cookie names that typically indicate session cookies
const SESSION_PATTERNS = [
  /sess/i,
  /sid/i,
  /token/i,
  /auth/i,
  /login/i,
  /jwt/i,
  /session/i,
];

interface CookieFlags {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: boolean;
  isSession: boolean;
}

function parseCookies(headers: Headers): CookieFlags[] {
  const cookies: CookieFlags[] = [];

  // Try getSetCookie() first (Node 20+), fall back to manual parsing
  let rawCookies: string[];
  if (typeof headers.getSetCookie === "function") {
    rawCookies = headers.getSetCookie();
  } else {
    const combined = headers.get("set-cookie");
    if (!combined) return [];
    // Split on ", " but avoid splitting inside Expires dates
    rawCookies = combined.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  }

  for (const raw of rawCookies) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const nameMatch = trimmed.match(/^([^=]+)=/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const lower = trimmed.toLowerCase();

    cookies.push({
      name,
      secure: lower.includes("secure"),
      httpOnly: lower.includes("httponly"),
      sameSite: /samesite\s*=\s*(strict|lax|none)/i.test(trimmed),
      isSession: SESSION_PATTERNS.some((p) => p.test(name)),
    });
  }

  return cookies;
}

/** Check Set-Cookie headers for security flags */
export function checkCookieSecurity(headers: Headers): CheckResult {
  const cookies = parseCookies(headers);

  if (cookies.length === 0) {
    return {
      id: "cookie-security",
      category: "headers",
      label: "Cookie Security",
      status: "skipped",
      score: 0,
      maxScore: 5,
      details: "No Set-Cookie headers found.",
    };
  }

  const issues: string[] = [];
  let sessionMissingCritical = false;

  for (const cookie of cookies) {
    const missing: string[] = [];
    if (!cookie.secure) missing.push("Secure");
    if (!cookie.httpOnly) missing.push("HttpOnly");
    if (!cookie.sameSite) missing.push("SameSite");

    if (missing.length > 0) {
      issues.push(`"${cookie.name}" missing ${missing.join(", ")}`);
      if (cookie.isSession && (!cookie.secure || !cookie.httpOnly)) {
        sessionMissingCritical = true;
      }
    }
  }

  if (issues.length === 0) {
    return {
      id: "cookie-security",
      category: "headers",
      label: "Cookie Security",
      status: "pass",
      score: 5,
      maxScore: 5,
      details: `All ${cookies.length} cookie${cookies.length !== 1 ? "s" : ""} have Secure, HttpOnly, and SameSite flags.`,
    };
  }

  if (sessionMissingCritical) {
    return {
      id: "cookie-security",
      category: "headers",
      label: "Cookie Security",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Session cookies missing critical flags: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}.`,
    };
  }

  return {
    id: "cookie-security",
    category: "headers",
    label: "Cookie Security",
    status: "warn",
    score: 2,
    maxScore: 5,
    details: `Some cookies missing flags: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}.`,
  };
}
