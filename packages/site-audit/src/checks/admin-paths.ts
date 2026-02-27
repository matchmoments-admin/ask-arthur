// Exposed admin path detection — HEAD requests to common sensitive paths

import type { CheckResult } from "../types";

// Common paths that should not be publicly accessible
const ADMIN_PATHS = [
  "/admin",
  "/wp-admin",
  "/wp-login.php",
  "/.env",
  "/.git/config",
  "/.git/HEAD",
  "/phpinfo.php",
  "/server-status",
  "/actuator",
  "/elmah.axd",
  "/.well-known/security.txt",
  "/robots.txt",
];

// Paths that are expected/fine to be accessible
const ALLOWED_PATHS = new Set(["/.well-known/security.txt", "/robots.txt"]);

// Paths that indicate info disclosure if accessible
const INFO_DISCLOSURE_PATHS = new Set([
  "/.env",
  "/.git/config",
  "/.git/HEAD",
  "/phpinfo.php",
  "/server-status",
  "/actuator",
  "/elmah.axd",
]);

/** Check for exposed admin/sensitive paths */
export async function checkExposedAdminPaths(
  baseUrl: string,
  timeoutMs: number = 3000
): Promise<CheckResult> {
  const exposed: string[] = [];
  const infoDisclosure: string[] = [];

  const checks = ADMIN_PATHS.map(async (path) => {
    try {
      const url = new URL(path, baseUrl).href;
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });

      // 2xx response means the path is accessible
      if (res.ok) {
        if (ALLOWED_PATHS.has(path)) {
          // These are fine to be accessible
          return;
        }
        if (INFO_DISCLOSURE_PATHS.has(path)) {
          infoDisclosure.push(path);
        } else {
          exposed.push(path);
        }
      }
    } catch {
      // Timeout or network error — path is not accessible
    }
  });

  await Promise.allSettled(checks);

  if (infoDisclosure.length > 0) {
    return {
      id: "admin-paths",
      category: "server",
      label: "Exposed Sensitive Paths",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Critical: ${infoDisclosure.join(", ")} ${infoDisclosure.length === 1 ? "is" : "are"} publicly accessible (information disclosure risk).${exposed.length > 0 ? ` Also found: ${exposed.join(", ")}.` : ""}`,
    };
  }

  if (exposed.length > 0) {
    return {
      id: "admin-paths",
      category: "server",
      label: "Exposed Sensitive Paths",
      status: "warn",
      score: 2,
      maxScore: 5,
      details: `Found ${exposed.length} accessible admin path${exposed.length !== 1 ? "s" : ""}: ${exposed.join(", ")}. Consider restricting access.`,
    };
  }

  return {
    id: "admin-paths",
    category: "server",
    label: "Exposed Sensitive Paths",
    status: "pass",
    score: 5,
    maxScore: 5,
    details: "No common admin or sensitive paths are publicly exposed.",
  };
}
