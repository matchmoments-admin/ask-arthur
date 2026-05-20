import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { ReferrerSource, ShopSignal, Verdict } from "@askarthur/types";
import { inngest } from "./inngest/client";
import { SHOP_SIGNAL_EVALUATED_EVENT } from "./inngest/events";
import { normalizeURL } from "./url-normalize";

export type ShopSignalSourceSurface =
  | "web"
  | "extension"
  | "mobile-share"
  | "bot-telegram"
  | "bot-whatsapp"
  | "bot-slack"
  | "bot-messenger"
  | "b2b-api";

export interface PersistShopSignalInput {
  requestId?: string;
  urls: readonly string[];
  verdict: Verdict;
  shopSignal: ShopSignal;
  sourceSurface?: ShopSignalSourceSurface | null;
  referrerSource?: ReferrerSource;
}

const SHOP_SIGNAL_SCORE_BY_VERDICT: Record<Verdict, number> = {
  SAFE: 15,
  UNCERTAIN: 40,
  SUSPICIOUS: 55,
  HIGH_RISK: 85,
};

function normalizeShopUrl(
  raw: string,
): { normalized: string; host: string } | null {
  const normalized = normalizeURL(raw) ?? normalizeURL(`https://${raw}`);
  if (!normalized) return null;
  try {
    return {
      normalized: normalized.normalized,
      host: new URL(normalized.normalized).hostname,
    };
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function resolveRequestId(requestId: string | undefined): string {
  return (
    requestId ??
    globalThis.crypto?.randomUUID?.() ??
    `shop-signal-${Date.now()}`
  );
}

export function shopSignalSourceSurface(
  surface: string,
  referrerSource?: ReferrerSource,
): ShopSignalSourceSurface | null {
  if (referrerSource) return "mobile-share";
  if (surface === "web") return "web";
  if (surface === "extension") return "extension";
  return null;
}

export async function persistShopSignalForPaidFeed(
  input: PersistShopSignalInput,
): Promise<
  | { persisted: true; shopCheckId: string }
  | { persisted: false; reason: string }
> {
  const url = input.urls
    .map(normalizeShopUrl)
    .find((candidate) => candidate !== null);
  if (!url) {
    return { persisted: false, reason: "no-url" };
  }

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shop_signal.persist.supabase_unavailable");
    return { persisted: false, reason: "supabase-unavailable" };
  }

  const requestId = resolveRequestId(input.requestId);
  const urlHashHex = await sha256Hex(url.normalized);
  const idempotencyKey = `shop-signal:${requestId}`;

  const { data, error } = await supabase.rpc("upsert_shop_check", {
    p_idempotency_key: idempotencyKey,
    p_url_hash: `\\x${urlHashHex}`,
    p_url_normalized: url.normalized,
    p_verdict: input.verdict,
    p_composite_score: SHOP_SIGNAL_SCORE_BY_VERDICT[input.verdict],
    p_signal: input.shopSignal,
    p_request_id: requestId,
    p_source_surface: input.sourceSurface ?? null,
    p_referrer_source: input.referrerSource ?? null,
  });

  if (error) {
    throw new Error(`upsert_shop_check failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("upsert_shop_check returned no shop_check id");
  }

  await inngest.send({
    name: SHOP_SIGNAL_EVALUATED_EVENT,
    id: idempotencyKey,
    data: {
      requestId,
      host: url.host,
      urls: [url.normalized],
      shopCheckId: data,
      shopSignal: input.shopSignal,
    },
  });

  logger.info("shop_signal.persisted", {
    requestId,
    shopCheckId: data,
    host: url.host,
    verdict: input.verdict,
  });

  return { persisted: true, shopCheckId: data };
}

export async function settleShopSignalPersistence(
  input: PersistShopSignalInput,
): Promise<
  PromiseSettledResult<
    Awaited<ReturnType<typeof persistShopSignalForPaidFeed>>
  >[]
> {
  const results = await Promise.allSettled([
    persistShopSignalForPaidFeed(input),
  ]);
  const result = results[0];
  if (result.status === "rejected") {
    logger.error("shop_signal.persist.failed", {
      error: String(result.reason),
      requestId: input.requestId,
    });
  }
  return results;
}
