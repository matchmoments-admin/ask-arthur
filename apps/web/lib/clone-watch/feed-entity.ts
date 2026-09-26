// Platform Entity bridge — the one module that turns a weaponised Clone Alert
// into a Platform Entity (scam_entities domain + hosting IP, plus a scam_urls
// row) and back again. Every caller — the weaponised.v1 consumer (feed-platform)
// and the admin triage route — crosses this seam; the write itself is the v309
// RPC pair so the two rows and the ledger stamp are one transaction.
//
// Gated FF_CLONE_WATCH_FEED_ENTITIES. BLAST-RADIUS: scam_entities and
// scam_urls power consumer-facing reputation (extension url-check, B2B
// /api/v1/entities, /scam-map), so only weaponised rows reach here — the RPC
// refuses anything else, whatever the caller passes (#1151: founder decision
// 2026-09-16, "weaponised = enough", with a retraction path instead of a gate).
//
// Cost telemetry: one `clone_watch_feed_entity` row per call, $0, metadata =
// the RPC's return. That is how the bridge shows on /admin/costs and how the
// silent-zero detector (#1145) can see it doing nothing.

import { LANES } from "@askarthur/scam-engine/lane-outcome";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

import { logCostAsync } from "@/lib/cost-telemetry";

/** One feature for the per-write `feed` rows AND the per-run Outcome Row — the
 *  roster owns the string so the detector and the dashboard read one value. */
export const FEED_ENTITY_COST_FEATURE = LANES["shopfront-clone-feed-platform"].feature;

export interface PlatformEntityUrlArgs {
  p_normalized_url: string;
  p_domain: string;
  p_subdomain: string | null;
  p_tld: string;
  p_full_path: string | null;
}

/**
 * Pure: the scam_urls identity of a clone's candidate URL, through the SAME
 * normaliser the extension's url-check and /api/scam-urls/report use — an
 * entry the extension cannot match by `normalized_url` reaches nobody.
 * Null when the URL is not http(s).
 */
export function platformEntityUrlArgs(
  candidateUrl: string,
): PlatformEntityUrlArgs | null {
  const n = normalizeURL(candidateUrl);
  if (!n) return null;
  return {
    p_normalized_url: n.normalized,
    p_domain: n.domain,
    p_subdomain: n.subdomain,
    p_tld: n.tld,
    p_full_path: n.fullPath || null,
  };
}

export type FeedEntityOutcome =
  | { kind: "skipped"; reason: "flag_off" | "no_client" | "bad_url" }
  | { kind: "not_written"; reason: string }
  | {
      kind: "written";
      domainEntityId: number | null;
      ipEntityId: number | null;
      scamUrlId: number | null;
    };

interface FeedRpcResult {
  written?: boolean;
  reason?: string;
  domain_entity_id?: number | null;
  ip_entity_id?: number | null;
  scam_url_id?: number | null;
}

/**
 * Feed ONE weaponised clone into the platform. Idempotent: the RPC no-ops on
 * a row already stamped `submitted_to.platform_entity`. Never throws on the
 * RPC's own refusals (not weaponised / fp / already fed) — those are outcomes,
 * reported in the cost row. Throws only on transport/RPC errors so a step
 * that wraps it retries.
 */
export async function feedCloneEntity(alert: {
  id: number;
  candidate_url: string;
}): Promise<FeedEntityOutcome> {
  if (!featureFlags.cloneWatchFeedEntities) {
    return { kind: "skipped", reason: "flag_off" };
  }
  const sb = createServiceClient();
  if (!sb) return { kind: "skipped", reason: "no_client" };

  const urlArgs = platformEntityUrlArgs(alert.candidate_url);
  if (!urlArgs) {
    logger.warn("clone-watch feed-entity: candidate_url not normalisable", {
      alertId: alert.id,
    });
    return { kind: "skipped", reason: "bad_url" };
  }

  const { data, error } = await sb.rpc("feed_clone_platform_entity", {
    p_alert_id: alert.id,
    ...urlArgs,
  });
  if (error) {
    throw new Error(
      `feed_clone_platform_entity failed for alert ${alert.id}: ${error.message}`,
    );
  }
  const r = (data ?? {}) as FeedRpcResult;

  await logCostAsync({
    feature: FEED_ENTITY_COST_FEATURE,
    provider: "internal",
    operation: "feed",
    units: 1,
    unitCostUsd: 0,
    metadata: { alert_id: alert.id, ...r },
  });

  if (!r.written) {
    return { kind: "not_written", reason: r.reason ?? "unknown" };
  }
  return {
    kind: "written",
    domainEntityId: r.domain_entity_id ?? null,
    ipEntityId: r.ip_entity_id ?? null,
    scamUrlId: r.scam_url_id ?? null,
  };
}

export type RetractEntityOutcome =
  | { kind: "skipped"; reason: "no_client" }
  | { kind: "not_retracted"; reason: string }
  | {
      kind: "retracted";
      entitiesDeleted: number;
      entitiesDetached: number;
      scamUrlDeactivated: boolean;
    };

interface RetractRpcResult {
  retracted?: boolean;
  reason?: string;
  entities_deleted?: number;
  entities_detached?: number;
  scam_url_deactivated?: boolean;
}

/**
 * The retraction path: withdraw a clone-sourced Platform Entity after an
 * `fp` triage. NOT flag-gated — a retraction must run even if the feed flag
 * has since been turned off, or an fp would stay in the consumer index.
 */
export async function retractCloneEntity(
  alertId: number,
): Promise<RetractEntityOutcome> {
  const sb = createServiceClient();
  if (!sb) return { kind: "skipped", reason: "no_client" };

  const { data, error } = await sb.rpc("retract_clone_platform_entity", {
    p_alert_id: alertId,
  });
  if (error) {
    throw new Error(
      `retract_clone_platform_entity failed for alert ${alertId}: ${error.message}`,
    );
  }
  const r = (data ?? {}) as RetractRpcResult;

  await logCostAsync({
    feature: FEED_ENTITY_COST_FEATURE,
    provider: "internal",
    operation: "retract",
    units: 1,
    unitCostUsd: 0,
    metadata: { alert_id: alertId, ...r },
  });

  if (!r.retracted) {
    return { kind: "not_retracted", reason: r.reason ?? "unknown" };
  }
  return {
    kind: "retracted",
    entitiesDeleted: r.entities_deleted ?? 0,
    entitiesDetached: r.entities_detached ?? 0,
    scamUrlDeactivated: r.scam_url_deactivated ?? false,
  };
}
