// Shared v1 query-param grammar — one parser so every evidence-feed
// endpoint (/api/v1/image-checks, /api/v1/document-checks, …) accepts the
// exact same `period` values the OpenAPI doc describes ("7d", 1–90 days,
// default 30; malformed → default). Divergent per-route copies drifted the
// day the second one was written (PR #1031 review).

export function parsePeriodDays(period: string | null): number {
  if (!period) return 30;
  const match = period.match(/^(\d+)d$/);
  if (!match) return 30;
  const days = parseInt(match[1]!);
  return Math.min(Math.max(days, 1), 90);
}
