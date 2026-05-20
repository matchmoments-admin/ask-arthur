import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { ShopSignal, Verdict } from "@askarthur/types";
import { inngest } from "./inngest/client";
import { SHOP_SIGNAL_EVALUATED_EVENT } from "./inngest/events";
import { normalizeURL } from "./url-normalize";

export type ShopCheckSourceSurface =
  | "web"
  | "extension"
  | "mobile-share"
  | "bot-telegram"
  | "bot-whatsapp"
  | "bot-slack"
  | "bot-messenger"
  | "b2b-api";

interface PersistAndEmitShopSignalInput {
  requestId?: string;
  urls: string[];
  verdict: Verdict;
  confidence: number;
  shopSignal: ShopSignal;
  sourceSurface?: ShopCheckSourceSurface | null;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function firstNormalizableUrl(urls: string[]): { normalized: string; host: string } | null {
  for (const raw of urls) {
    const normalized = normalizeURL(raw);
    if (!normalized) continue;
    try {
      return {
        normalized: normalized.normalized,
        host: new URL(normalized.normalized).hostname,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function compositeScore(verdict: Verdict, confidence: number): number {
  const base: Record<Verdict, number> = {
    SAFE: 10,
    UNCERTAIN: 45,
    SUSPICIOUS: 65,
    HIGH_RISK: 90,
  };
  const boundedConfidence = Math.max(0, Math.min(1, confidence));
  const confidenceBump = Math.round((boundedConfidence - 0.5) * 20);
  return Math.max(0, Math.min(100, base[verdict] + confidenceBump));
}

export function sourceSurfaceForAnalyzeSurface(
  surface: "web" | "extension" | "media" | "bot",
  hasReferrerSource: boolean,
): ShopCheckSourceSurface | null {
  if (surface === "web") return hasReferrerSource ? "mobile-share" : "web";
  if (surface === "extension") return "extension";
  return null;
}

/**
 * Write the cheap-path Shop Signal row, then emit the paid-provider fan-out.
 * URL-less commerce detections are intentionally skipped: APIVoid needs a
 * host, and shop_checks.url_hash is NOT NULL. The Stage-0 JSONB measurement
 * shim still captures those detections on scam_reports.
 */
export async function persistAndEmitShopSignalEvaluation(
  input: PersistAndEmitShopSignalInput,
): Promise<{ shopCheckId?: string; skipped?: string }> {
  const primary = firstNormalizableUrl(input.urls);
  if (!primary) {
    return { skipped: "no_normalizable_url" };
  }

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shop-signal: supabase unavailable, skipping shop_checks write");
    return { skipped: "supabase_unavailable" };
  }

  const urlHash = `\\x${await sha256Hex(primary.normalized)}`;
  const idempotencyKey = input.requestId
    ? `shop_signal:${input.requestId}:${primary.normalized}`
    : null;

  const { data, error } = await supabase.rpc("upsert_shop_check", {
    p_idempotency_key: idempotencyKey,
    p_url_hash: urlHash,
    p_url_normalized: primary.normalized,
    p_verdict: input.verdict,
    p_composite_score: compositeScore(input.verdict, input.confidence),
    p_signal: input.shopSignal,
    p_request_id: input.requestId ?? null,
    p_source_surface: input.sourceSurface ?? null,
    p_referrer_source: input.shopSignal.referrerSource ?? null,
  });

  if (error) {
    throw new Error(`upsert_shop_check failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("upsert_shop_check returned no id");
  }

  const shopCheckId = String(data);
  await inngest.send({
    name: SHOP_SIGNAL_EVALUATED_EVENT,
    id: input.requestId ?? shopCheckId,
    data: {
      requestId: input.requestId ?? shopCheckId,
      host: primary.host,
      urls: input.urls,
      shopCheckId,
      shopSignal: input.shopSignal,
    },
  });

  return { shopCheckId };
}
