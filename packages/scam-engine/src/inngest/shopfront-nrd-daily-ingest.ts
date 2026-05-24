// Shopfront clone-watch — Layer 0 NRD daily ingest.
//
// Runs once daily at 08:30 UTC against the whoisds free NRD zip,
// lexical-matches every newly-registered domain against the static
// AU brand watchlist, UPSERTs hits into shopfront_clone_alerts
// (target_shop_id IS NULL branch, source = 'nrd'), and sends a
// Telegram summary to the admin chat.
//
// URL is computed from yesterday's UTC date — whoisds publishes
// each day's NRD list as a free zip at a deterministic
// base64-of-"YYYY-MM-DD.zip" URL. No auth, no env-var maintenance,
// no monthly rotation. WHOISDS_NRD_ZIP_URL still works as an
// optional override for testing or emergency source-switching.
//
// See docs/plans/clone-watch-mvp.md §4 PR 2 for the full contract.
//
// Expected duration: 30s-3min for ~70K domains/day. Hard-capped
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
const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB compressed — 10x the legit
                                        // whoisds payload (~5-15 MB)
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB — zip-bomb guard
const UPSERT_CHUNK_SIZE = 5_000;
const TELEGRAM_DIGEST_TOP_N = 5;
const FAILED_CHUNK_THROW_RATIO = 0.1; // throw if >10% of chunks failed

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
    // Singleton — prevent overlap on slow run or manual invoke during cron
    // window. Matches the shape used by other singleton crons in this
    // codebase (cluster-builder, enrichment, urlscan-enrichment, etc).
    concurrency: { limit: 1 },
  },
  // Two triggers:
  //   - cron: the daily 08:30 UTC sweep
  //   - event: lets ops re-run the ingest ad-hoc (smoke tests, back-fills,
  //     post-incident replays) without leaning on the Inngest dashboard
  //     "Invoke" button. Send via the events API with the production
  //     INNGEST_EVENT_KEY. Event payload is ignored — the fn always
  //     fetches yesterday's NRD list unless WHOISDS_NRD_ZIP_URL overrides.
  [
    { cron: "30 8 * * *" },
    { event: "shopfront/nrd.manual-trigger.v1" },
  ],
  async ({ step }) => {
    if (!featureFlags.shopfrontCloneWatch) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_WATCH disabled" };
    }

    // Compute yesterday's NRD URL from UTC date. Override possible via
    // WHOISDS_NRD_ZIP_URL for tests, emergency source-switching, or
    // back-fills against a specific historical date.
    const nrdUrl = process.env.WHOISDS_NRD_ZIP_URL ?? computeNrdUrl(yesterdayUtc());

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
        failed_chunks: upsertResult.failed_chunks,
        total_chunks: upsertResult.total_chunks,
      });
    });

    await step.run("send-telegram-digest", async () => {
      await sendTelegramDigest({
        domains_scanned: domains.length,
        hits,
        inserted: upsertResult.inserted,
        failed_chunks: upsertResult.failed_chunks,
      });
    });

    logger.info("shopfront-nrd: run complete", {
      domains: domains.length,
      hits: hits.length,
      inserted: upsertResult.inserted,
      failed_chunks: upsertResult.failed_chunks,
    });

    return {
      domains_scanned: domains.length,
      hits_found: hits.length,
      rows_inserted: upsertResult.inserted,
      failed_chunks: upsertResult.failed_chunks,
    };
  },
);

// ── URL computation ──────────────────────────────────────────────────────

/**
 * The whoisds free-tier daily NRD list lives at a deterministic URL
 * derived from base64(YYYY-MM-DD.zip). No auth required (the page's
 * terms state "free of charge … without a license and without any
 * payment"). The cron runs at 08:30 UTC and fetches *yesterday's*
 * list — whoisds publishes each day's NRD overnight UTC.
 */
export function computeNrdUrl(date: Date): string {
  const iso = formatUtcDate(date); // "YYYY-MM-DD"
  const filename = `${iso}.zip`;
  const b64 = Buffer.from(filename, "utf8").toString("base64");
  return `https://www.whoisds.com/whois-database/newly-registered-domains/${b64}/nrd`;
}

export function yesterdayUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  let uncompressedBytesSeen = 0;
  for (const entry of entries) {
    const text = await entry.async("string");
    // Zip-bomb defence: a malicious zip can compress 1000:1. Cap the
    // aggregate decompressed bytes across all entries to keep memory
    // bounded even if the compressed payload was within MAX_ZIP_BYTES.
    uncompressedBytesSeen += text.length;
    if (uncompressedBytesSeen > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(
        `NRD zip decompressed-size cap exceeded (${uncompressedBytesSeen} > ${MAX_UNCOMPRESSED_BYTES})`,
      );
    }
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
  failed_chunks: number;
  total_chunks: number;
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
  if (hits.length === 0) {
    return { inserted: 0, failed_chunks: 0, total_chunks: 0 };
  }

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("shopfront-nrd: Supabase client unavailable — skipping upsert");
    return { inserted: 0, failed_chunks: 0, total_chunks: 0 };
  }

  let inserted = 0;
  let failed_chunks = 0;
  let total_chunks = 0;
  for (let i = 0; i < hits.length; i += UPSERT_CHUNK_SIZE) {
    total_chunks++;
    const chunk = hits.slice(i, i + UPSERT_CHUNK_SIZE);
    const rows = chunk.map(buildUpsertRow);
    const { data, error } = await supabase.rpc("upsert_clone_alerts_batch", {
      p_rows: rows,
    });
    if (error) {
      failed_chunks++;
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

  // If a large fraction of chunks failed, fail the Inngest step so the run
  // surfaces as red on the dashboard rather than reporting "0 new rows" on
  // what's actually a broken pipeline.
  if (
    total_chunks > 0 &&
    failed_chunks / total_chunks > FAILED_CHUNK_THROW_RATIO
  ) {
    throw new Error(
      `shopfront-nrd: ${failed_chunks}/${total_chunks} chunks failed (>${
        FAILED_CHUNK_THROW_RATIO * 100
      }%)`,
    );
  }

  return { inserted, failed_chunks, total_chunks };
}

// ── Cost telemetry + error log ───────────────────────────────────────────

async function logCostTelemetry(args: {
  domains_scanned: number;
  hits_found: number;
  rows_inserted: number;
  failed_chunks: number;
  total_chunks: number;
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
      failed_chunks: args.failed_chunks,
      total_chunks: args.total_chunks,
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
  failed_chunks: number;
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
  if (args.failed_chunks > 0) {
    lines.push(
      `⚠️ <b>${args.failed_chunks}</b> chunk(s) failed — see cost_telemetry WHERE feature='shopfront_clone_watch_error'`,
    );
  }
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
