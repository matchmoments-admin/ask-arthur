/**
 * Seed a Brand Subscriber's known_brands row on activation (#1304, v348).
 *
 * known_brands holds the two per-brand facts the rest of clone-watch reads by
 * brand: the CATEGORY (the weaponisation-risk input, looked up by
 * brand_domain — lowest-id non-null, #1305) and the brand's PUBLIC security
 * contact (RFC 9116). Its only automatic writer, known-brands-discover,
 * enumerates the active watchlist — and a Brand Subscriber joins that overlay
 * only once verified. So activation seeds the row itself, without un-parking
 * the discover cron (#1230):
 *
 *   1. seed_known_brand_for_subscriber (v348) — matches an existing row by
 *      domain / Canonical Brand / name and only fills a category gap, or
 *      inserts a contact-less, unprobed row with the operator's category.
 *   2. On 'created' only, send the discover event. The unprobed row is at the
 *      head of that fn's worklist, so the run probes the brand's own
 *      security.txt. The event id is per subscriber, so a replayed webhook
 *      does not queue a second run (Inngest de-duplicates ids for 24h).
 *
 * It never copies the subscriber's alert contact into known_brands: that
 * contact lives on monitored_brands and every send to it passes the Brand Send
 * Gate "subscriber" profile (#1295 decision 4). known_brands' contact receives
 * onward brand-abuse reports, so only discovery or a human sets it.
 *
 * Never throws: seeding is a side effect of an activation that has already
 * succeeded (a webhook must still return 200). Failure is logged at warn and
 * returned as an outcome the caller can surface.
 */

import { inngest } from "@askarthur/scam-engine/inngest/client";
import type { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { deriveBrandKey } from "@/app/api/inngest/functions/report-brand-stewardship";
import { KNOWN_BRANDS_DISCOVER_EVENT } from "@/app/api/inngest/functions/known-brands-discover";
import type { ScoredBrandCategory } from "./weaponisation-risk";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

export type KnownBrandSeedOutcome =
  | "created"
  | "existing"
  | "existing_category_set"
  | "not_subscriber"
  | "no_domain"
  | "failed";

export interface KnownBrandSeedResult {
  outcome: KnownBrandSeedOutcome;
  knownBrandId: number | null;
  /** Whether the discover run was requested (only on 'created'). */
  probeRequested: boolean;
}

export async function seedKnownBrandForSubscriber(
  sb: ServiceClient,
  input: {
    brandSubscriberId: number;
    /** The subscriber's display name — the brand_key slug is derived from it.
     *  Read from the row when the caller does not have it (the webhook). */
    brandName?: string | null;
    brandCategory?: ScoredBrandCategory | null;
  },
): Promise<KnownBrandSeedResult> {
  let brandName = input.brandName ?? null;
  if (!brandName) {
    const { data: sub, error: subErr } = await sb
      .from("monitored_brands")
      .select("brand_name")
      .eq("id", input.brandSubscriberId)
      .maybeSingle();
    if (subErr) {
      logger.warn("known-brand-seed: subscriber read failed", {
        brandSubscriberId: input.brandSubscriberId,
        error: subErr.message,
      });
      return { outcome: "failed", knownBrandId: null, probeRequested: false };
    }
    brandName = (sub?.brand_name as string | undefined) ?? null;
    if (!brandName) return { outcome: "not_subscriber", knownBrandId: null, probeRequested: false };
  }

  const { data, error } = await sb.rpc("seed_known_brand_for_subscriber", {
    p_brand_subscriber_id: input.brandSubscriberId,
    p_brand_key: deriveBrandKey(brandName),
    p_brand_category: input.brandCategory ?? null,
  });
  if (error) {
    logger.warn("known-brand-seed: seed failed", {
      brandSubscriberId: input.brandSubscriberId,
      error: error.message,
    });
    return { outcome: "failed", knownBrandId: null, probeRequested: false };
  }
  const row = (data as Array<{ known_brand_id: number | null; outcome: KnownBrandSeedOutcome }> | null)?.[0];
  const outcome = row?.outcome ?? "failed";
  const knownBrandId = row?.known_brand_id ?? null;

  let probeRequested = false;
  if (outcome === "created") {
    try {
      await inngest.send({
        id: `known-brand-seed-${input.brandSubscriberId}`,
        name: KNOWN_BRANDS_DISCOVER_EVENT,
        data: { reason: "brand_subscriber_activated", brandSubscriberId: input.brandSubscriberId },
      });
      probeRequested = true;
    } catch (err) {
      // The row is seeded and unprobed: the next discover run (any trigger)
      // picks it up first. Not fatal.
      logger.warn("known-brand-seed: discover event not sent", {
        brandSubscriberId: input.brandSubscriberId,
        error: String(err),
      });
    }
  }

  // warn: activation is a rare, high-value event.
  logger.warn("known-brand-seed.outcome", {
    brandSubscriberId: input.brandSubscriberId,
    outcome,
    knownBrandId,
    probeRequested,
  });
  return { outcome, knownBrandId, probeRequested };
}
