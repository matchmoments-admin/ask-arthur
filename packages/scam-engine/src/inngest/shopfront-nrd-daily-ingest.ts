// Shopfront clone-watch — Layer 0 NRD daily ingest.
//
// Runs once daily at 08:30 UTC against the whoisds free NRD zip,
// lexical-matches every newly-registered domain against the static
// AU brand watchlist, UPSERTs hits into shopfront_clone_alerts
// (target_shop_id IS NULL branch, source = 'nrd'), and sends a
// Telegram summary to the admin chat.
//
// See docs/plans/clone-watch-mvp.md §4 PR 2 for the full contract.
//
// Expected duration: 30s-3min for ~100K-1M domains/day. Hard-capped
// to <5 min per CLAUDE.md Inngest rule. statement_timeout='300s' per
// CLAUDE.md long-running write loop rule.

import JSZip from "jszip";
import { fetch as undiciFetch } from "undici";

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  AU_BRAND_WATCHLIST,
  canonicaliseCandidateUrl,
  lexicalMatch,
  urlHash,
} from "@askarthur/shopfront-glue";
import { ssrfSafeDispatcher } from "../ssrf-dispatcher";

const ZIP_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ZIP_BYTES = 200 * 1024 * 1024; // 200 MB
const UPSERT_CHUNK_SIZE = 5_000;
const TELEGRAM_DIGEST_TOP_N = 5;

interface MatchHit {
  candidate_domain: string;
  candidate_url: string;
  url_hash: string;
  brand: string;
  legitimate_domain: string;
  score: number;
  signal_type: string;
  evidence: Record<string, string | number>;
}

export const shopfrontNrdDailyIngest = inngest.createFunction(
  {
    id: "shopfront-nrd-daily-ingest",
    name: "Shopfront Clone-Watch: Daily NRD Ingest",
    // Per CLAUDE.md "<5 min" rule. Add 1m safety margin.
    timeouts: { finish: "6m" },
  },
  { cron: "30 8 * * *" },
  async ({ step }) => {
    if (!featureFlags.shopfrontCloneWatch) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_WATCH disabled" };
    }

    const nrdUrl = process.env.WHOISDS_NRD_ZIP_URL;
    if (!nrdUrl) {
      logger.warn("shopfront-nrd: WHOISDS_NRD_ZIP_URL unset — skipping run");
      await logErrorTelemetry("nrd_url_missing", { url_set: false });
      return { skipped: true, reason: "WHOISDS_NRD_ZIP_URL unset" };
    }

    // Download + parse in a single step: Inngest serialises step return
    // values to JSON, so a Uint8Array can't cross step boundaries.
    const domains = await step.run("download-and-parse-nrd", async () => {
      const buf = await downloadNrdZip(nrdUrl);
      return parseNrdZip(buf);
    });

    const hits = await step.run("lexical-match-domains", async () => {
      return matchDomains(domains);
    });

    const upsertResult = await step.run("upsert-clone-alerts", async () => {
      return upsertHitsInChunks(hits);
    });

    await step.run("log-cost-telemetry", async () => {
      await logCostTelemetry({
        domains_scanned: domains.length,
        hits_found: hits.length,
        rows_inserted: upsertResult.inserted,
      });
    });

    await step.run("send-telegram-digest", async () => {
      await sendTelegramDigest({
        domains_scanned: domains.length,
        hits,
        inserted: upsertResult.inserted,
      });
    });

    logger.info("shopfront-nrd: run complete", {
      domains: domains.length,
      hits: hits.length,
      inserted: upsertResult.inserted,
    });

    return {
      domains_scanned: domains.length,
      hits_found: hits.length,
      rows_inserted: upsertResult.inserted,
    };
  },
);

// ── Downloads ─────────────────────────────────────────────────────────────

async function downloadNrdZip(url: string): Promise<Uint8Array> {
  const res = await undiciFetch(url, {
    dispatcher: ssrfSafeDispatcher,
    signal: AbortSignal.timeout(ZIP_DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`NRD download HTTP ${res.status}`);
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_ZIP_BYTES) {
    throw new Error(`NRD zip too large: ${contentLength} bytes`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`NRD zip too large after download: ${buf.byteLength} bytes`);
  }
  return new Uint8Array(buf);
}

async function parseNrdZip(zipBuffer: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".txt"),
  );
  if (entries.length === 0) {
    throw new Error("NRD zip contained no .txt entries");
  }
  const out: string[] = [];
  for (const entry of entries) {
    const text = await entry.async("string");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().toLowerCase();
      if (!line || line.startsWith("#")) continue;
      out.push(line);
    }
  }
  return out;
}

// ── Matching ──────────────────────────────────────────────────────────────

async function matchDomains(domains: string[]): Promise<MatchHit[]> {
  const hits: MatchHit[] = [];
  for (const domain of domains) {
    const result = lexicalMatch(domain, AU_BRAND_WATCHLIST);
    if (!result) continue;
    const candidate_url = canonicaliseCandidateUrl(domain);
    const url_hash = await urlHash(candidate_url);
    hits.push({
      candidate_domain: domain,
      candidate_url,
      url_hash,
      brand: result.brand,
      legitimate_domain: result.legitimate_domain,
      score: result.score,
      signal_type: result.signal_type,
      evidence: result.evidence,
    });
  }
  return hits;
}

// ── Upsert ────────────────────────────────────────────────────────────────

export interface UpsertChunkResult {
  inserted: number;
}

export function buildUpsertRow(hit: MatchHit) {
  // Composite severity at MVP is brand_match * 40 (visual + semantic = 0).
  // Matcher caps score < 1.0 + we use Math.floor so severity stays ≤ 39,
  // which maps to severity_tier 'low' per #376 formula.
  const severity = Math.floor(hit.score * 40);
  return {
    target_shop_id: "",
    inferred_target_domain: hit.legitimate_domain,
    candidate_domain: hit.candidate_domain,
    candidate_url: hit.candidate_url,
    url_hash: hit.url_hash,
    signals: [
      {
        type: "brand_match",
        score: hit.score,
        signal_type: hit.signal_type,
        evidence: hit.evidence,
        fired_at: new Date().toISOString(),
      },
    ],
    severity,
    severity_tier: "low",
    source: "nrd",
  };
}

async function upsertHitsInChunks(hits: MatchHit[]): Promise<UpsertChunkResult> {
  if (hits.length === 0) return { inserted: 0 };

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shopfront-nrd: Supabase client unavailable — skipping upsert");
    return { inserted: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < hits.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = hits.slice(i, i + UPSERT_CHUNK_SIZE);
    const rows = chunk.map(buildUpsertRow);
    const { data, error } = await supabase.rpc("upsert_clone_alerts_batch", {
      p_rows: rows,
    });
    if (error) {
      logger.error("shopfront-nrd: upsert chunk failed", {
        chunk_start: i,
        chunk_size: chunk.length,
        error: error.message,
      });
      await logErrorTelemetry("upsert_chunk_failed", {
        chunk_start: i,
        chunk_size: chunk.length,
        message: error.message,
      });
      continue;
    }
    inserted += typeof data === "number" ? data : 0;
  }

  return { inserted };
}

// ── Cost telemetry + error log ───────────────────────────────────────────

async function logCostTelemetry(args: {
  domains_scanned: number;
  hits_found: number;
  rows_inserted: number;
}): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "shopfront_clone_watch",
    provider: "whoisds",
    operation: "nrd_daily_ingest",
    units: args.domains_scanned,
    estimated_cost_usd: 0,
    metadata: {
      domains_scanned: args.domains_scanned,
      hits_found: args.hits_found,
      rows_inserted: args.rows_inserted,
    },
  });
}

async function logErrorTelemetry(
  kind: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "shopfront_clone_watch_error",
    provider: "whoisds",
    operation: kind,
    estimated_cost_usd: 0,
    metadata: meta,
  });
}

// ── Telegram digest ──────────────────────────────────────────────────────

async function sendTelegramDigest(args: {
  domains_scanned: number;
  hits: MatchHit[];
  inserted: number;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    logger.warn(
      "shopfront-nrd: TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID unset — skipping digest",
    );
    return;
  }

  const brandCounts = new Map<string, number>();
  for (const hit of args.hits) {
    brandCounts.set(hit.brand, (brandCounts.get(hit.brand) ?? 0) + 1);
  }
  const topBrands = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TELEGRAM_DIGEST_TOP_N);

  const lines: string[] = [];
  lines.push(`<b>Clone-watch · daily NRD sweep</b>`);
  lines.push(
    `Scanned <b>${args.domains_scanned.toLocaleString()}</b> domains · <b>${args.hits.length}</b> hits · <b>${args.inserted}</b> new rows.`,
  );
  if (topBrands.length > 0) {
    lines.push("");
    lines.push("<b>Top brands:</b>");
    for (const [brand, count] of topBrands) {
      lines.push(`· ${escapeHtml(brand)} — ${count}`);
    }
  }
  lines.push("");
  lines.push(
    `<i>askarthur.au/clone-watch (gated noindex; flip after #371 v1 copy)</i>`,
  );

  try {
    const res = await undiciFetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        dispatcher: ssrfSafeDispatcher,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      logger.warn("shopfront-nrd: telegram digest HTTP", { status: res.status });
    }
  } catch (err) {
    logger.warn("shopfront-nrd: telegram digest failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
