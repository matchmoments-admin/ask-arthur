/**
 * Clone-Watch-only mode — the ONE home for what stays running when
 * `FF_CLONE_WATCH_ONLY` is on (founder decision 2026-10-12: run Clone Watch
 * only, ~US$106 → ~US$22/mo; runbook docs/ops/clone-watch-only-mode.md).
 *
 * Three consumers read this module, and each enforces one slice of the mode:
 *   - apps/web/app/api/inngest/route.ts   — serves only CLONE_WATCH_KEEP_IDS
 *     (`keepCloneWatchFunctions`), so the next Inngest sync deregisters the
 *     rest. Nothing is deleted; turning the flag off and re-syncing restores.
 *   - apps/web/middleware.ts              — `isAllowedInCloneWatchOnly`:
 *     everything else gets 503 `{"error":"paused"}` (API) or a 307 to /paused.
 *   - apps/web/app/api/cron/alerting-canary — skips the liveness floors of
 *     CLONE_WATCH_ONLY_PAUSED_ALERTERS (their crons are removed from
 *     vercel.json, so their silence is expected, not a dead alerter).
 *
 * Vercel crons cannot be flag-gated; the removed entries live in the runbook.
 * __tests__/cloneWatchOnly.test.ts pins every list here against the real
 * registry (function ids, laneHealth crons, vercel.json).
 */

/**
 * Inngest function ids served while the mode is on. Every `shopfront-clone-*`
 * and `clone-watch-*` function (parked ones included — they run on their
 * manual-trigger event), the NRD ingest that feeds them, the monthly brand
 * report, the two onward senders clone-watch enforcement-execute emits to
 * (`report.onward.openphish` / `report.onward.apwg`), and cost logging.
 */
export const CLONE_WATCH_KEEP_IDS: ReadonlySet<string> = new Set([
  // Ingest — the source of every Clone Alert.
  "shopfront-nrd-daily-ingest",
  // shopfront-clone-*
  "shopfront-clone-enforcement-execute",
  "shopfront-clone-enforcement-plan",
  "shopfront-clone-feed-platform",
  "shopfront-clone-fp-cluster-digest",
  "shopfront-clone-haiku-preclassify",
  "shopfront-clone-lifecycle-recheck",
  "shopfront-clone-netcraft-auto",
  "shopfront-clone-netcraft-issue",
  "shopfront-clone-netcraft-reconcile",
  "shopfront-clone-notify-brand",
  "shopfront-clone-notify-brand-prepare",
  "shopfront-clone-notify-weaponised",
  "shopfront-clone-reemergence-monitor",
  "shopfront-clone-urlscan-retrieve",
  "shopfront-clone-urlscan-scan-one",
  "shopfront-clone-urlscan-submit",
  "shopfront-clone-weekly-digest",
  // clone-watch-*
  "clone-watch-enrich-attribution",
  "clone-watch-internal-digest",
  "clone-watch-month-end-liveness",
  "clone-watch-report-summary",
  // Monthly Brand Stewardship Report (consumes clone-watch-report-summary's
  // monthly-store-written event).
  "report-brand-stewardship",
  // Onward senders for shopfront-clone-enforcement-execute.
  "report-onward-openphish",
  "report-onward-apwg",
  // Cost logging + billing import (the cost digests stay on).
  "cost-telemetry-retention",
  "billing-ingest-nightly",
]);

/**
 * The Vercel crons that stay in apps/web/vercel.json. Everything else was
 * removed by the clone-watch-only PR (entries preserved in the runbook).
 */
export const CLONE_WATCH_KEPT_CRON_PATHS: readonly string[] = [
  "/api/cron/clone-lead-digest",
  "/api/cron/clone-watch-retention",
  "/api/cron/onward-retention",
  "/api/cron/cost-daily-check",
  "/api/cron/cost-weekly-digest",
  "/api/cron/pg-stuck-query-watchdog",
  "/api/cron/axiom-fleet-watch",
  "/api/cron/health-digest",
  "/api/cron/alerting-canary",
];

/**
 * Alerters whose cron is removed in this mode. alerting-canary skips their
 * liveness floor so a paused alerter does not page as a dead one.
 */
export const CLONE_WATCH_ONLY_PAUSED_ALERTERS: readonly string[] = [
  "scraper-brake-alert",
  "feedback-digest",
];

/** Pages (and their sub-paths) that stay reachable. Segment-matched. */
const ALLOWED_PAGE_PREFIXES: readonly string[] = [
  "/blog",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
  "/paused",
  "/clone-watch",
  "/clone-report",
  "/brand-exposure",
  // The A$300 brand pilot is sold from /pricing (contact path; #1310).
  "/pricing",
  "/admin",
  // Spam Act: every brand / clone-watch email carries an unsubscribe link.
  "/unsubscribe",
  // LinkedIn short links → /clone-watch editions; the destination is gated.
  "/go",
  // Generated icons (app/icon.tsx, app/apple-icon.tsx) and site files.
  "/icon",
  "/apple-icon",
  "/manifest",
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known",
  "/_next",
];

/** APIs (and their sub-paths) that stay reachable. Segment-matched. */
const ALLOWED_API_PREFIXES: readonly string[] = [
  // Clone Watch.
  "/api/clone-list-request",
  "/api/clone-watch",
  "/api/brand-stewardship",
  "/api/brand-exposure", // the /brand-exposure page's only data source
  // Email + subscription (unsubscribe links in clone-watch emails).
  "/api/webhooks/resend",
  "/api/subscribe",
  "/api/unsubscribe",
  "/api/unsubscribe-one-click",
  // Contact form on /contact, and the blog's first-party pageview beacon.
  "/api/leads",
  "/api/events",
  // Brand pilot payments.
  "/api/stripe/webhook",
  "/api/brand/checkout",
  // Infrastructure + admin.
  "/api/inngest",
  "/api/admin",
  ...CLONE_WATCH_KEPT_CRON_PATHS,
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * True when `pathname` stays reachable in Clone-Watch-only mode. API paths
 * are judged only against the API allowlist (an `/api/x.json` is not a static
 * file); a non-API path ending in a static-asset extension passes.
 */
export function isAllowedInCloneWatchOnly(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return ALLOWED_API_PREFIXES.some((p) => matchesPrefix(pathname, p));
  }
  if (pathname === "/" || pathname === "") return true;
  if (ALLOWED_PAGE_PREFIXES.some((p) => matchesPrefix(pathname, p))) return true;
  return STATIC_ASSET.test(pathname);
}

// Explicit extensions, not "anything with a dot": /report/example.com is a
// consumer page, and a dotted domain in its last segment must not pass.
const STATIC_ASSET =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|txt|xml|webmanifest|json|woff2?|ttf|otf|css|js|map|pdf|mp4|webm)$/i;

/** The id an Inngest function registers under (SDK 3.x: `fn.id()`). */
export function inngestFunctionId(fn: unknown): string {
  const maybe = fn as { id?: unknown; opts?: { id?: unknown } };
  if (typeof maybe.id === "function") return String((maybe.id as () => string)());
  if (typeof maybe.opts?.id === "string") return maybe.opts.id;
  throw new Error("inngestFunctionId: object is not an Inngest function");
}

/** The subset of `fns` that runs in Clone-Watch-only mode. */
export function keepCloneWatchFunctions<T>(fns: readonly T[]): T[] {
  return fns.filter((fn) => CLONE_WATCH_KEEP_IDS.has(inngestFunctionId(fn)));
}
