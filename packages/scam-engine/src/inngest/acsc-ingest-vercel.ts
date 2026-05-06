// ACSC alerts/advisories ingest — Vercel-runtime variant.
//
// Why this exists: the Python pipeline/scrapers/acsc_alerts.py runs from
// GitHub Actions (Azure egress IPs), which Akamai tarpits at the
// application layer (proven by probe_acsc.py: 41/41 ReadTimeout failures
// across all UAs/methods/endpoints — see BACKLOG.md). Vercel egress IPs
// are different and may not be tarpitted.
//
// This function is gated default-OFF behind featureFlags.acscIngestVercel.
// Flipping it on for the first time is the test — read the resulting
// feed_ingestion_log row to see whether Vercel egress works:
//
//   SELECT status, records_new, error_message
//   FROM feed_ingestion_log
//   WHERE feed_name = 'acsc' AND created_at > now() - interval '1 hour'
//   ORDER BY created_at DESC LIMIT 5;
//
// If green, leave the flag on and add a follow-up PR to remove the
// (permanently broken) GH Actions Python step. If still tarpitted,
// flip the flag off, document the gap, ship Scamwatch + ASIC as our
// AU regulator coverage.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import { fetchAcscFeed, toFeedItemRow } from "../news-intel/acsc-fetch";

const FEEDS = [
  { kind: "alerts", url: "https://www.cyber.gov.au/rss/alerts" },
  { kind: "advisories", url: "https://www.cyber.gov.au/rss/advisories" },
] as const;

export const acscIngestVercel = inngest.createFunction(
  {
    id: "acsc-ingest-vercel",
    name: "News Intel: ACSC alerts/advisories (Vercel egress)",
    retries: 1,
  },
  { cron: "0 */3 * * *" },
  async ({ step }) => {
    if (!featureFlags.acscIngestVercel) {
      return { skipped: true, reason: "acscIngestVercel flag off" };
    }

    const start = Date.now();

    // ── Step 1: fetch both feeds in sequence (small + serial keeps the
    // diagnostic output readable in Inngest logs) ─────────────────────
    const fetchResults = await step.run("fetch-feeds", async () => {
      const results: Array<{
        kind: string;
        url: string;
        ok: boolean;
        status: number;
        items: number;
        error?: string;
      }> = [];
      const allRows: ReturnType<typeof toFeedItemRow>[] = [];
      for (const feed of FEEDS) {
        const r = await fetchAcscFeed(feed.url);
        results.push({
          kind: feed.kind,
          url: feed.url,
          ok: r.ok,
          status: r.status,
          items: r.items.length,
          error: r.error,
        });
        if (r.ok) {
          for (const it of r.items) {
            allRows.push(toFeedItemRow(it, feed.kind));
          }
        }
      }
      return { results, rows: allRows };
    });

    const totalErrors = fetchResults.results.filter((r) => !r.ok);
    const fetchedCount = fetchResults.rows.length;

    logger.info("acsc-ingest-vercel: fetch summary", {
      results: fetchResults.results,
    });

    // ── Step 2: upsert feed_items. Idempotent via (source, external_id)
    // partial unique index from migration v97. We use upsert with
    // ignoreDuplicates=false so existing rows get updated titles/bodies. ─
    const upsertCount = await step.run("upsert-feed-items", async () => {
      if (fetchResults.rows.length === 0) return 0;
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { error, count } = await supabase
        .from("feed_items")
        .upsert(fetchResults.rows, {
          onConflict: "source,external_id",
          ignoreDuplicates: false,
          count: "exact",
        });
      if (error) {
        throw new Error(`feed_items upsert failed: ${error.message}`);
      }
      return count ?? fetchResults.rows.length;
    });

    // ── Step 3: log to feed_ingestion_log so it shows up in /admin/health
    // alongside the Python runner's rows. status='partial' if either feed
    // failed (we got at least some data but not all); 'error' if both
    // failed; 'success' if all good. ─────────────────────────────────────
    const status =
      totalErrors.length === FEEDS.length
        ? "error"
        : totalErrors.length > 0
          ? "partial"
          : "success";
    const errorMessage =
      totalErrors.length > 0
        ? totalErrors
            .map((r) => `${r.kind}: ${r.error ?? `HTTP ${r.status}`}`)
            .join("; ")
            .slice(0, 500)
        : null;
    const durationMs = Date.now() - start;

    await step.run("log-ingestion", async () => {
      const supabase = createServiceClient();
      if (!supabase) return;
      await supabase.from("feed_ingestion_log").insert({
        feed_name: "acsc",
        status,
        records_fetched: fetchedCount,
        records_new: upsertCount,
        records_updated: 0,
        records_skipped: 0,
        duration_ms: durationMs,
        error_message: errorMessage,
        record_type: "url",
      });
    });

    logger.info("acsc-ingest-vercel: complete", {
      status,
      fetched: fetchedCount,
      upserted: upsertCount,
      durationMs,
      errors: errorMessage,
    });

    return {
      status,
      fetched: fetchedCount,
      upserted: upsertCount,
      durationMs,
      perFeed: fetchResults.results,
    };
  },
);
