// scam_reports + verified_scams embedding backfill + verified_scams steady state.
//
// Two triggers:
//   * daily cron — the STEADY-STATE embed path for verified_scams (see below).
//   * SCAM_REPORTS_BACKFILL_EMBED_EVENT — the manual historical-tail backfill;
//     each invocation embeds up to 5000 rows across both tables (whichever has
//     more NULL embeddings first). Fire it repeatedly to drain a large tail.
//
// Why a cron was added (2026-07-12 fleet review). scam_reports get a synchronous
// embed on insert via scam-report-embed.ts (scam-report.stored.v1) — but that
// consumer ONLY handles scam_reports; verified_scams have NO synchronous path,
// and storeVerifiedScam emits no stored-event. The result was 39/64 (61%)
// verified_scams sitting unembedded, silently degrading hybrid search over the
// authoritative scam anchors. The original header wrongly implied both tables
// embed synchronously. A daily cron is the lowest-risk fix: the fn already gates
// on `embedding IS NULL` and updates idempotently, so it only embeds the day's
// new verified_scams (and any scam_reports the sync path missed) and breaks as
// soon as a batch comes back short — ~2 near-empty step.runs/day at steady state.
// The old "a cron would race the synchronous path" worry is moot: for
// scam_reports the shared `embedding IS NULL` gate + idempotent write makes an
// overlap benign, and for verified_scams there is no other writer to race.
//
// (A per-row stored-event consumer mirroring scam-report-embed would be more
// "synchronous", but it needs a new event + wiring storeVerifiedScam + a new fn
// registration; the cron reuses this already-correct batch logic. Tracked as a
// follow-up if verified_scam volume ever makes daily latency matter.)

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { vectorToPgString } from "@askarthur/utils/pgvector";

import { inngest } from "./client";
import { spanningBudget } from "./step-budget";
import { withAxiomLogging } from "./with-axiom-logging";
import { SCAM_REPORTS_BACKFILL_EMBED_EVENT } from "./events";
import { embed, type EmbeddingDomain } from "../embeddings";
import { isFeatureBraked } from "../cost-log";

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 50; // 5000 rows max per invocation

/**
 * Wall-clock budget for the whole batch loop, in milliseconds.
 *
 * SPANNING, not in-step: the loop awaits `step.run` per batch, so it crosses
 * step boundaries and its clock must be `event.ts` — a Date.now() taken in the
 * handler body is reset by every replay and the guard could never fire
 * (#1124). See ./step-budget.ts for the two bounds.
 *
 * WHY IT MATTERS HERE. The loop is capped at MAX_BATCHES_PER_RUN, and it exits
 * as soon as a batch comes back short — so on a drained worklist a run costs
 * two or three step boundaries and this budget never fires. The cap only binds
 * during a real backfill, and there it is a COUNT with no time bound at all:
 * the run could hold one of the account's five slots for as long as the
 * batches took (ADR-0019). This makes the run's cost bounded in the unit that
 * is actually scarce.
 *
 * Stopping early is safe because the worklist is self-healing — an unembedded
 * row is selected again by the next run, and the cron is daily.
 */
//
// ONE budget spans BOTH passes (scam_reports then verified_scams). Two
// independent budgets would let a run take twice as long as either.
const BACKFILL_WALL_CLOCK_MS = 600_000;

const FINANCE_SCAM_TYPES = new Set<string>([
  "investment",
  "investment_scam",
  "investment_fraud",
  "crypto",
  "crypto_scam",
  "bec",
  "business_email_compromise",
  "invoice",
  "invoice_fraud",
  "bank_impersonation",
]);

function selectDomain(scamType: string | null | undefined): EmbeddingDomain {
  if (!scamType) return "generic";
  return FINANCE_SCAM_TYPES.has(scamType.toLowerCase()) ? "finance" : "generic";
}

interface ScamReportRow {
  id: number;
  scrubbed_content: string | null;
  scam_type: string | null;
  channel: string | null;
  impersonated_brand: string | null;
  verdict: string;
}

interface VerifiedScamRow {
  id: number;
  summary: string | null;
  scam_type: string | null;
  channel: string | null;
  impersonated_brand: string | null;
}

function buildScamReportText(r: ScamReportRow): string {
  const parts: string[] = [];
  if (r.scam_type) parts.push(`type:${r.scam_type}`);
  if (r.channel) parts.push(`channel:${r.channel}`);
  if (r.impersonated_brand) parts.push(`brand:${r.impersonated_brand}`);
  parts.push(r.scrubbed_content ?? "");
  return parts.join(" | ").slice(0, 4000);
}

function buildVerifiedScamText(r: VerifiedScamRow): string {
  const parts: string[] = [];
  if (r.scam_type) parts.push(`type:${r.scam_type}`);
  if (r.channel) parts.push(`channel:${r.channel}`);
  if (r.impersonated_brand) parts.push(`brand:${r.impersonated_brand}`);
  parts.push(r.summary ?? "");
  return parts.join(" | ").slice(0, 4000);
}

async function logCost(args: {
  estimatedCostUsd: number;
  totalTokens: number;
  provider: string;
  modelId: string;
  table: "scam_reports" | "verified_scams";
  domain: EmbeddingDomain;
  rowsEmbedded: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "scam-reports-backfill-embed",
    provider: args.provider,
    operation: "embeddings.create",
    units: args.totalTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      table: args.table,
      domain: args.domain,
      total_tokens: args.totalTokens,
      rows_embedded: args.rowsEmbedded,
    },
  });
}

export const scamReportsBackfillEmbed = inngest.createFunction(
  {
    id: "scam-reports-backfill-embed",
    name: "Analyze: Backfill scam_reports + verified_scams embeddings",
    retries: 2,
    concurrency: { limit: 1 },
    // ADR-0019's circuit breaker, absent until #1135. This function had the
    // worst structural boundary count in the fleet: 1 + 50 + 50 + 1 = 102.
    //
    // inngest-finish-budget: 22 boundaries — 102 cannot co-occur with a 600s
    // wall clock: at the 30s-per-boundary queue wait ADR-0019 measures, 600s
    // admits ~20 batch boundaries, +2 for the brake and cost steps. Declaring
    // 102 would put the floor at 3690s — a 62-minute "circuit breaker" for a
    // run the budget already bounds at ~660s. 22 x 30s = 660s queue wait; 600s
    // BACKFILL_WALL_CLOCK_MS; 60s slack = 1320s. Declared 23m (1380s).
    //
    // Both loops also exit on a short batch, so on a drained worklist a run is
    // two or three boundaries and none of this binds. See BACKLOG.md on the
    // floor formula double-counting a spanning budget's queue wait.
    timeouts: { finish: "23m" },
  },
  [
    // Steady-state delta for verified_scams (+ any scam_reports the sync path
    // missed). 05:30 UTC — after the 03–05 retention window, quiet slot.
    { cron: "30 5 * * *" },
    { event: SCAM_REPORTS_BACKFILL_EMBED_EVENT },
  ],
  withAxiomLogging(
    { fnId: "scam-reports-backfill-embed" },
    async ({ event, step }) => {
      // Autonomous paid spend now (daily cron) → honour the same embedding brake
      // that scam-report-embed uses, set by cost-daily-check when embed spend
      // exceeds its cap. The manual backfill respects it too (operator can clear
      // the brake to force a drain).
      const braked = await step.run("check-embed-brake", () =>
        isFeatureBraked("scam_report_embed"),
      );
      if (braked) {
        return {
          paused: true,
          reason: "feature_brakes.scam_report_embed is set",
        };
      }

      let scamReportsEmbedded = 0;
      let verifiedScamsEmbedded = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      let lastModelId = "";

      // Each batch is a SINGLE step.run that loads + embeds + writes,
      // returning only a summary. The per-step state limit is 32 MB and
      // every step output is persisted as JSON; returning the embed
      // vectors (200 × 1024 floats ≈ 2.5 MB per batch) hit the cap on the
      // ACNC backfill at ~13 batches with InngestErrStateOverflowed.
      // Folding into one step keeps the vectors inside the closure; the
      // step output is a tiny count/tokens summary.

      const budget = spanningBudget({ event }, BACKFILL_WALL_CLOCK_MS, logger);
      let stoppedForTime = false;

      // ── Pass 1: scam_reports (skip SAFE, skip short content) ──────────
      for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_RUN; batchIdx++) {
        if (budget.expired()) {
          stoppedForTime = true;
          logger.warn("scam-reports-backfill-embed: wall-clock break", {
            pass: "scam_reports",
            batchesDone: batchIdx,
          });
          break;
        }
        const summaries = await step.run(
          `scam-reports-batch-${batchIdx}`,
          async () => {
            const supabase = createServiceClient();
            if (!supabase)
              throw new Error("Supabase service client unavailable");

            const { data, error: loadErr } = await supabase
              .from("scam_reports")
              .select(
                "id, scrubbed_content, scam_type, channel, impersonated_brand, verdict",
              )
              .is("embedding", null)
              .neq("verdict", "SAFE")
              .not("scrubbed_content", "is", null)
              .order("id", { ascending: true })
              .limit(BATCH_SIZE);

            if (loadErr)
              throw new Error(`load-scam-reports failed: ${loadErr.message}`);
            const rows = ((data ?? []) as ScamReportRow[]).filter(
              (r) => r.scrubbed_content && r.scrubbed_content.length >= 40,
            );

            if (rows.length === 0) {
              return { perDomain: [], rowsRequested: 0 };
            }

            // Group by domain so each domain sends one model call.
            const byDomain = new Map<EmbeddingDomain, ScamReportRow[]>();
            for (const r of rows) {
              const d = selectDomain(r.scam_type);
              if (!byDomain.has(d)) byDomain.set(d, []);
              byDomain.get(d)!.push(r);
            }

            const perDomain: Array<{
              domain: EmbeddingDomain;
              written: number;
              totalTokens: number;
              estimatedCostUsd: number;
              provider: string;
              modelId: string;
            }> = [];

            for (const [domain, domainRows] of byDomain.entries()) {
              const texts = domainRows.map(buildScamReportText);
              const result = await embed(texts, { domain });

              if (result.vectors.length !== domainRows.length) {
                throw new Error(
                  `embed-scam-reports count mismatch: ${result.vectors.length} for ${domainRows.length}`,
                );
              }

              let written = 0;
              for (let i = 0; i < domainRows.length; i++) {
                const { error: writeErr } = await supabase
                  .from("scam_reports")
                  .update({
                    embedding: vectorToPgString(result.vectors[i]),
                    embedding_model_version: result.modelId,
                  })
                  .eq("id", domainRows[i].id);
                if (writeErr) {
                  logger.warn("scam-reports-backfill: row update failed", {
                    id: domainRows[i].id,
                    error: writeErr.message,
                  });
                  continue;
                }
                written++;
              }

              await logCost({
                estimatedCostUsd: result.estimatedCostUsd,
                totalTokens: result.totalTokens,
                provider: result.provider,
                modelId: result.modelId,
                table: "scam_reports",
                domain,
                rowsEmbedded: written,
              });

              perDomain.push({
                domain,
                written,
                totalTokens: result.totalTokens,
                estimatedCostUsd: result.estimatedCostUsd,
                provider: result.provider,
                modelId: result.modelId,
              });
            }

            return { perDomain, rowsRequested: rows.length };
          },
        );

        if (summaries.rowsRequested === 0) break;
        for (const s of summaries.perDomain) {
          scamReportsEmbedded += s.written;
          totalTokens += s.totalTokens;
          totalCostUsd += s.estimatedCostUsd;
          if (s.modelId) lastModelId = s.modelId;
        }
        if (summaries.rowsRequested < BATCH_SIZE) break;
      }

      // ── Pass 2: verified_scams (no SAFE filter — verified rows are
      //          authoritative anchors, all of them embed) ─────────────────
      for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_RUN; batchIdx++) {
        if (budget.expired()) {
          stoppedForTime = true;
          logger.warn("scam-reports-backfill-embed: wall-clock break", {
            pass: "verified_scams",
            batchesDone: batchIdx,
          });
          break;
        }
        const summaries = await step.run(
          `verified-scams-batch-${batchIdx}`,
          async () => {
            const supabase = createServiceClient();
            if (!supabase)
              throw new Error("Supabase service client unavailable");

            const { data, error: loadErr } = await supabase
              .from("verified_scams")
              .select("id, summary, scam_type, channel, impersonated_brand")
              .is("embedding", null)
              .not("summary", "is", null)
              .order("id", { ascending: true })
              .limit(BATCH_SIZE);

            if (loadErr)
              throw new Error(`load-verified-scams failed: ${loadErr.message}`);
            const rows = ((data ?? []) as VerifiedScamRow[]).filter(
              (r) => r.summary && r.summary.length >= 20,
            );

            if (rows.length === 0) {
              return { perDomain: [], rowsRequested: 0 };
            }

            const byDomain = new Map<EmbeddingDomain, VerifiedScamRow[]>();
            for (const r of rows) {
              const d = selectDomain(r.scam_type);
              if (!byDomain.has(d)) byDomain.set(d, []);
              byDomain.get(d)!.push(r);
            }

            const perDomain: Array<{
              domain: EmbeddingDomain;
              written: number;
              totalTokens: number;
              estimatedCostUsd: number;
              modelId: string;
            }> = [];

            for (const [domain, domainRows] of byDomain.entries()) {
              const texts = domainRows.map(buildVerifiedScamText);
              const result = await embed(texts, { domain });

              if (result.vectors.length !== domainRows.length) {
                throw new Error(
                  `embed-verified-scams count mismatch: ${result.vectors.length} for ${domainRows.length}`,
                );
              }

              let written = 0;
              for (let i = 0; i < domainRows.length; i++) {
                const { error: writeErr } = await supabase
                  .from("verified_scams")
                  .update({
                    embedding: vectorToPgString(result.vectors[i]),
                    embedding_model_version: result.modelId,
                  })
                  .eq("id", domainRows[i].id);
                if (writeErr) {
                  logger.warn("verified-scams-backfill: row update failed", {
                    id: domainRows[i].id,
                    error: writeErr.message,
                  });
                  continue;
                }
                written++;
              }

              await logCost({
                estimatedCostUsd: result.estimatedCostUsd,
                totalTokens: result.totalTokens,
                provider: result.provider,
                modelId: result.modelId,
                table: "verified_scams",
                domain,
                rowsEmbedded: written,
              });

              perDomain.push({
                domain,
                written,
                totalTokens: result.totalTokens,
                estimatedCostUsd: result.estimatedCostUsd,
                modelId: result.modelId,
              });
            }

            return { perDomain, rowsRequested: rows.length };
          },
        );

        if (summaries.rowsRequested === 0) break;
        for (const s of summaries.perDomain) {
          verifiedScamsEmbedded += s.written;
          totalTokens += s.totalTokens;
          totalCostUsd += s.estimatedCostUsd;
          if (s.modelId) lastModelId = s.modelId;
        }
        if (summaries.rowsRequested < BATCH_SIZE) break;
      }

      logger.info("scam-reports-backfill-embed: complete", {
        scamReportsEmbedded,
        verifiedScamsEmbedded,
        totalTokens,
        estimatedCostUsd: totalCostUsd.toFixed(6),
        modelId: lastModelId,
        stoppedForTime,
        budgetDegraded: budget.degraded,
      });

      return {
        scamReportsEmbedded,
        verifiedScamsEmbedded,
        totalTokens,
        estimatedCostUsd: totalCostUsd,
        modelId: lastModelId,
        // A partial run must not read as a small one: the budget stopped it
        // and the remainder is waiting in the self-healing worklist.
        stoppedForTime,
        budgetDegraded: budget.degraded,
      };
    },
  ),
);
