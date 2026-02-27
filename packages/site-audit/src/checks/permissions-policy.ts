// Permissions-Policy + legacy Feature-Policy parser

import type { CheckResult, PermissionDirective } from "../types";

// Sensitive features that should be restricted
const SENSITIVE_FEATURES = [
  "camera",
  "microphone",
  "geolocation",
  "payment",
  "usb",
  "bluetooth",
  "autoplay",
];

/** Parse Permissions-Policy header into directives */
export function parsePermissionsPolicy(value: string): PermissionDirective[] {
  const directives: PermissionDirective[] = [];

  // Format: feature=(allowlist), feature2=(allowlist2)
  // e.g. "camera=(), microphone=(self), geolocation=(self "https://example.com")"
  const parts = value.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const feature = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const rawAllowlist = trimmed.slice(eqIdx + 1).trim();

    // Extract values from parentheses
    const match = rawAllowlist.match(/\(([^)]*)\)/);
    const inner = match ? match[1].trim() : rawAllowlist;
    const allowlist = inner ? inner.split(/\s+/).map((s) => s.replace(/"/g, "")) : [];

    // Empty allowlist () means denied to all
    const isRestricted = allowlist.length === 0 || !allowlist.includes("*");

    directives.push({ feature, allowlist, isRestricted });
  }

  return directives;
}

/** Parse legacy Feature-Policy header */
export function parseFeaturePolicy(value: string): PermissionDirective[] {
  const directives: PermissionDirective[] = [];

  // Format: feature 'allowlist'; feature2 'allowlist2'
  const parts = value.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [feature, ...values] = trimmed.split(/\s+/);
    const allowlist = values.map((v) => v.replace(/'/g, ""));
    const isRestricted = allowlist.includes("none") || !allowlist.includes("*");

    directives.push({
      feature: feature.toLowerCase(),
      allowlist,
      isRestricted,
    });
  }

  return directives;
}

/** Check Permissions-Policy header */
export function checkPermissionsPolicy(headers: Headers): CheckResult {
  const ppValue = headers.get("permissions-policy");
  const fpValue = headers.get("feature-policy");

  if (!ppValue && !fpValue) {
    return {
      id: "permissions-policy",
      category: "permissions",
      label: "Permissions Policy",
      status: "fail",
      score: 0,
      maxScore: 10,
      details:
        "No Permissions-Policy or Feature-Policy header found. Browser features like camera, microphone, and geolocation are unrestricted.",
    };
  }

  const directives = ppValue
    ? parsePermissionsPolicy(ppValue)
    : parseFeaturePolicy(fpValue!);

  // Count how many sensitive features are restricted
  const restrictedSensitive = SENSITIVE_FEATURES.filter((feature) => {
    const directive = directives.find((d) => d.feature === feature);
    return directive?.isRestricted;
  });

  const ratio = restrictedSensitive.length / SENSITIVE_FEATURES.length;

  if (ratio >= 0.7) {
    return {
      id: "permissions-policy",
      category: "permissions",
      label: "Permissions Policy",
      status: "pass",
      score: 10,
      maxScore: 10,
      details: `${ppValue ? "Permissions-Policy" : "Feature-Policy"} restricts ${restrictedSensitive.length}/${SENSITIVE_FEATURES.length} sensitive features.`,
    };
  }

  if (ratio >= 0.3) {
    return {
      id: "permissions-policy",
      category: "permissions",
      label: "Permissions Policy",
      status: "warn",
      score: 5,
      maxScore: 10,
      details: `${ppValue ? "Permissions-Policy" : "Feature-Policy"} only restricts ${restrictedSensitive.length}/${SENSITIVE_FEATURES.length} sensitive features.`,
    };
  }

  return {
    id: "permissions-policy",
    category: "permissions",
    label: "Permissions Policy",
    status: "warn",
    score: 2,
    maxScore: 10,
    details: `${ppValue ? "Permissions-Policy" : "Feature-Policy"} present but only restricts ${restrictedSensitive.length}/${SENSITIVE_FEATURES.length} sensitive features.`,
  };
}
