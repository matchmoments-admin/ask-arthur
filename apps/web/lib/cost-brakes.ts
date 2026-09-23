// Which cost_telemetry features count toward each env-capped cost brake.
//
// cost-daily-check sums today's spend per brake and, over the cap, writes a
// feature_brakes row that the brake's workers read. That sum used to be an
// inline `t.feature === "…" || …` chain per brake, re-typed by hand, and it
// rotted: on 2026-09-24 five of its terms had no writer anywhere in the repo
// (three clone-watch lanes deleted months earlier, two shop-signal
// diagnostics that were never emitted). A term with no writer is harmless to
// the sum but false as documentation — the reader believes spend is governed
// that isn't, or looks for a lane that doesn't exist.
//
// One list per brake, here. costBrakeRegistry.test.ts walks the repo and
// fails if any listed feature has no writer, so a deleted lane cannot leave
// its tag behind again. The brake KEY (left) is the feature_brakes.feature
// the workers check; the spend FEATURES (right) are cost_telemetry.feature
// tags — hyphen-tag / underscore-key splits (reddit_intel, *_embed) are
// deliberate and pre-date this file.
//
// Caps, thresholds and the upsert/Telegram logic stay in the cron: they are
// bespoke per brake (phone_footprint adds telco_api_usage spend the telemetry
// table never sees).

import type { KNOWN_BRAKE_KEYS } from "@/lib/dashboard/feature-brakes";

type BrakeKey = (typeof KNOWN_BRAKE_KEYS)[number];

export const BRAKE_SPEND_FEATURES = {
  vuln_au_enrichment: ["vuln_au_enrichment"],
  // Every reddit-intel-* Claude tag must be here or REDDIT_INTEL_CAP_USD does
  // not govern its spend. `reddit-intel-truncated` is deliberately absent: a
  // $0 diagnostic marker. competitor-intel-extract (Arthur's Watch Phase 2)
  // shares this brake.
  reddit_intel: [
    "reddit-intel-classify",
    // A retry re-sends the whole 40-post batch — the most expensive row this
    // feature produces. Missing from the sum until 2026-08-10.
    "reddit-intel-classify-retry",
    "reddit-intel-embed",
    "reddit-intel-name-themes",
    "reddit-intel-weekly-synthesis",
    // Arthur's Take stage-2 generation (TAKE_COST_FEATURE).
    "reddit-intel-take",
    "competitor-intel-extract",
  ],
  // Telemetry half only — the cron adds telco_api_usage (Vonage) spend.
  phone_footprint: ["phone_footprint"],
  charity_check: ["charity_check"],
  // `shop_signal` carries the per-call APIVoid cost; the `-error` tag is a $0
  // diagnostic summed in for tag-drift resilience.
  shop_signal: ["shop_signal", "shop-signal-apivoid-error"],
  shop_signal_reviews: ["shop_signal_reviews"],
  // Engaging this pauses ALL clone-watch outreach for 24h; the upstream NRD
  // ingest (shopfront_clone_watch) has its own brake below.
  shopfront_clone_outreach: [
    "shopfront_clone_notify_brand",
    "shopfront_clone_weekly_digest",
    "shopfront_clone_urlscan",
    // Pre-classifier: Haiku (real $), Jev (v311+), and their $0 `_error`
    // diagnostics (surface in health-digest). Constants live in
    // lib/clone-watch/jev-classify-one.ts.
    "shopfront_clone_preclassify",
    "shopfront_clone_preclassify_error",
    "shopfront_clone_preclassify_jev",
    "shopfront_clone_preclassify_jev_error",
  ],
  shopfront_clone_watch: ["shopfront_clone_watch"],
  news_intel_embed: ["news-intel-embed"],
  scam_report_embed: ["scam-report-embed"],
  bot_analyze: ["bot_analyze"],
  hive_ai: ["hive_ai"],
  extension_image_check: ["extension_image_check"],
} as const satisfies Partial<Record<BrakeKey, readonly string[]>>;

export type SpendBrake = keyof typeof BRAKE_SPEND_FEATURES;

/**
 * Today's spend toward one brake. Sums, never `.find()`s: daily_cost_summary
 * groups by (day, feature, provider), so a multi-provider feature yields
 * several rows and `.find()` silently keeps only the first (charity_check
 * under-counted this way).
 */
export function brakeSpend(
  rows: readonly { feature: string; cost: number }[],
  brake: SpendBrake,
): number {
  const features: readonly string[] = BRAKE_SPEND_FEATURES[brake];
  return rows
    .filter((r) => features.includes(r.feature))
    .reduce((sum, r) => sum + r.cost, 0);
}
