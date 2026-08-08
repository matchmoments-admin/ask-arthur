// Kill-switch surface for /admin/health (#951).
//
// feature_brakes is how spend and outbound activity get halted, and it was
// SQL-only: during an incident — the exact moment you least want to be typing
// INSERT statements — the only way to pull a brake was the SQL editor. Worse,
// an EMPTY table means "nothing braked", which is indistinguishable at a glance
// from "I forgot to check".
//
// Brake semantics are inherited, not redefined: a feature is braked when its
// row's paused_until is in the FUTURE (packages/scam-engine/src/cost-log.ts
// isFeatureBraked). A lapsed row is inert, so it is shown as expired, not
// active — the console must not imply a brake is holding when it isn't.

import "server-only";

import type { createServiceClient } from "@askarthur/supabase/server";

type Svc = ReturnType<typeof createServiceClient>;

/**
 * Every brake key a worker actually checks. Sourced by grepping
 * isFeatureBraked() call sites + the cost-daily-check cron's auto-pause keys,
 * so the panel can offer a brake for a feature that has never been braked
 * before (an empty table must not mean an empty console).
 * Kept in sync by featureBrakes.test.ts, which greps the same call sites.
 */
export const KNOWN_BRAKE_KEYS = [
  "bot_analyze",
  "charity_check",
  "clone_enforcement",
  "clone_netcraft_issue",
  "clone_netcraft_resubmit",
  "extension_image_check",
  "hive_ai",
  "monthly_intel_blog",
  "news_intel_embed",
  "onward_reporting",
  "reddit_intel",
  "scam_contacts_twilio",
  "shopfront_clone_outreach",
  "shopfront_clone_recheck",
] as const;

export interface BrakeRow {
  feature: string;
  /** True only when paused_until is in the future — the same test the
   *  workers apply. A past timestamp is inert. */
  active: boolean;
  pausedUntil: string | null;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
  /** Never braked in this table — offered so it can be braked from here. */
  neverSet: boolean;
}

export async function getBrakeRows(svc: Svc, errors?: string[]): Promise<BrakeRow[]> {
  if (!svc) return [];
  const { data, error } = await svc
    .from("feature_brakes")
    .select("feature, paused_until, reason, set_by, set_at");
  if (error) errors?.push("feature brakes");

  const now = Date.now();
  const byFeature = new Map<string, BrakeRow>();
  for (const r of data ?? []) {
    const pausedUntil = (r.paused_until as string | null) ?? null;
    byFeature.set(r.feature as string, {
      feature: r.feature as string,
      active: !!pausedUntil && new Date(pausedUntil).getTime() > now,
      pausedUntil,
      reason: (r.reason as string | null) ?? null,
      setBy: (r.set_by as string | null) ?? null,
      setAt: (r.set_at as string | null) ?? null,
      neverSet: false,
    });
  }
  for (const key of KNOWN_BRAKE_KEYS) {
    if (byFeature.has(key)) continue;
    byFeature.set(key, {
      feature: key,
      active: false,
      pausedUntil: null,
      reason: null,
      setBy: null,
      setAt: null,
      neverSet: true,
    });
  }
  // Active brakes first — they're the ones changing system behaviour right now.
  return [...byFeature.values()].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.feature.localeCompare(b.feature),
  );
}
