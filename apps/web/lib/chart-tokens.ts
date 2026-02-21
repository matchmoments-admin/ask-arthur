// WCAG-accessible verdict colors (darken from theme for white-bg contrast)
export const VERDICT_COLORS = {
  safe: "#2E7D32",
  suspicious: "#E65100",
  danger: "#C62828",
} as const;

// 5-level choropleth gradient: empty → deep-navy
export const CHOROPLETH_SCALE = [
  "#E8EDF3", // 0 – no data
  "#A8C4DA", // 1 – low
  "#5A8FB8", // 2 – medium-low
  "#2B5F8A", // 3 – medium-high
  "#001F3F", // 4 – high
] as const;

// Maps full state names (from ip-api.com regionName) → state code + SVG ID prefix
export const AU_STATE_MAP: Record<string, { code: string; prefix: string }> = {
  "New South Wales": { code: "NSW", prefix: "nsw" },
  "Victoria": { code: "VIC", prefix: "vic" },
  "Queensland": { code: "QLD", prefix: "qld" },
  "South Australia": { code: "SA", prefix: "sa" },
  "Western Australia": { code: "WA", prefix: "wa" },
  "Tasmania": { code: "TAS", prefix: "tas" },
  "Northern Territory": { code: "NT", prefix: "nt" },
  "Australian Capital Territory": { code: "ACT", prefix: "act" },
};

// Reverse map: state code → SVG prefix
export const CODE_TO_PREFIX: Record<string, string> = Object.fromEntries(
  Object.values(AU_STATE_MAP).map(({ code, prefix }) => [code, prefix])
);

/**
 * Parse a region string like "Sydney, New South Wales" into a state code like "NSW".
 * Returns null if the region doesn't match an Australian state.
 */
export function parseStateFromRegion(region: string): string | null {
  const parts = region.split(", ");
  const stateName = parts[parts.length - 1];
  return AU_STATE_MAP[stateName]?.code ?? null;
}
