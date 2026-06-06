import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

export interface EntityWrite {
  p_entity_type: "domain" | "ip";
  p_normalized_value: string;
  p_country_code: string | null;
}

/**
 * Pure: which scam_entities upserts a confirmed clone produces — the clone
 * domain and (when urlscan captured it) the hosting IP, tagged with the hosting
 * country. Separated from the RPC calls so it's unit-testable.
 */
export function buildEntityWrites(
  candidateDomain: string,
  hostingIp: string | null,
  hostingCountry: string | null,
): EntityWrite[] {
  const writes: EntityWrite[] = [];
  const domain = candidateDomain.trim().toLowerCase();
  if (domain) {
    writes.push({
      p_entity_type: "domain",
      p_normalized_value: domain,
      p_country_code: hostingCountry,
    });
  }
  const ip = hostingIp?.trim();
  if (ip) {
    writes.push({
      p_entity_type: "ip",
      p_normalized_value: ip,
      p_country_code: hostingCountry,
    });
  }
  return writes;
}

/**
 * Feed a CONFIRMED clone (domain + hosting IP) into the unified scam_entities
 * index, so the consumer reputation lookup, /scam-map, and B2B feeds all see it
 * and the IP cross-links to other scams sharing that infra.
 *
 * Gated FF_CLONE_WATCH_FEED_ENTITIES (default OFF). BLAST-RADIUS: scam_entities
 * powers consumer-facing reputation, so only strict-bar auto-confirmed or
 * operator-confirmed clones should reach here — keep the flag OFF until the FP
 * rate is validated. Reuses report_scam_entity (v170), which upserts on
 * (entity_type, normalized_value) and stores country_code. No scam_report link
 * (clones have none). Non-fatal — never blocks the confirm path.
 */
export async function feedCloneEntity(
  candidateDomain: string,
  hostingIp: string | null,
  hostingCountry: string | null,
): Promise<void> {
  if (!featureFlags.cloneWatchFeedEntities) return;
  const sb = createServiceClient();
  if (!sb) return;

  for (const w of buildEntityWrites(candidateDomain, hostingIp, hostingCountry)) {
    const { error } = await sb.rpc("report_scam_entity", {
      p_entity_type: w.p_entity_type,
      p_normalized_value: w.p_normalized_value,
      p_country_code: w.p_country_code,
    });
    if (error) {
      logger.warn("clone-watch feed-entity: report_scam_entity failed", {
        entityType: w.p_entity_type,
        error: error.message,
      });
    }
  }
}
