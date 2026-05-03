// scam-report.stored.v1 → embedding pass.
//
// Receives the event emitted by analyze-report.ts after a scam_reports row
// lands and writes a 1024-dim Voyage embedding to scam_reports.embedding +
// stamps embedding_model_version per ADR-0003. Domain-routes to
// voyage-finance-2 for finance-shaped scam_types and voyage-3.5 generic
// for everything else.
//
// Why a separate function rather than chaining inside analyze-report.ts:
// the embed call is the one network dependency that's most likely to
// transiently fail (Voyage rate-limit, Voyage outage, key rotation).
// Splitting embed off lets it fail and retry independently of the
// row-write step — same pattern as reddit-intel-embed.ts. Inngest
// dedup on the event id (`scam-report-stored-${reportId}`) prevents
// duplicate embed passes.
//
// Idempotency: only updates rows where embedding IS NULL, so retries
// after partial writes are safe.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import {
  SCAM_REPORT_STORED_EVENT,
  parseScamReportStoredData,
} from "./events";
import { embed, type EmbeddingDomain } from "../embeddings";

// scam_types that route to voyage-finance-2. Names follow the analyze
// pipeline's classifier output. Anything not in this set falls back to
// the generic domain.
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

function selectDomain(scamType: string | null): EmbeddingDomain {
  if (!scamType) return "generic";
  return FINANCE_SCAM_TYPES.has(scamType.toLowerCase()) ? "finance" : "generic";
}

// Composite text for embedding — scrubbed_content carries the user-facing
// signal, structured fields disambiguate near-clones (e.g. ATO impersonation
// vs Medicare impersonation that share "your refund is pending" body text).
function buildEmbedText(args: {
  scrubbed_content: string;
  scam_type: string | null;
  channel: string | null;
  impersonated_brand: string | null;
}): string {
  const parts: string[] = [];
  if (args.scam_type) parts.push(`type:${args.scam_type}`);
  if (args.channel) parts.push(`channel:${args.channel}`);
  if (args.impersonated_brand) parts.push(`brand:${args.impersonated_brand}`);
  parts.push(args.scrubbed_content);
  return parts.join(" | ").slice(0, 4000);
}

function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

async function logCost(args: {
  estimatedCostUsd: number;
  totalTokens: number;
  provider: string;
  modelId: string;
  domain: EmbeddingDomain;
  reportId: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "scam-report-embed",
    provider: args.provider,
    operation: "embeddings.create",
    units: args.totalTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      domain: args.domain,
      total_tokens: args.totalTokens,
      report_id: args.reportId,
    },
  });
}

export const scamReportEmbed = inngest.createFunction(
  {
    id: "scam-report-embed",
    name: "Analyze: Embed scam_report row",
    idempotency: "event.data.reportId",
    retries: 3,
  },
  { event: SCAM_REPORT_STORED_EVENT },
  async ({ event, step }) => {
    const data = await step.run("parse-event", () =>
      parseScamReportStoredData(event.data),
    );

    // Re-check the gate at consumer side too — a misconfigured emitter
    // shouldn't be able to force an embed of a SAFE / short report.
    if (data.verdict === "SAFE" || data.contentLength < 40) {
      return {
        skipped: true,
        reason: "verdict_safe_or_short_content",
        reportId: data.reportId,
      };
    }

    const row = await step.run("load-row", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const { data: rowData, error } = await supabase
        .from("scam_reports")
        .select(
          "id, scrubbed_content, scam_type, channel, impersonated_brand, embedding",
        )
        .eq("id", data.reportId)
        .maybeSingle<{
          id: number;
          scrubbed_content: string | null;
          scam_type: string | null;
          channel: string | null;
          impersonated_brand: string | null;
          embedding: unknown;
        }>();

      if (error) {
        throw new Error(`load-row failed: ${error.message}`);
      }
      return rowData;
    });

    if (!row) {
      logger.warn("scam-report-embed: row not found", {
        reportId: data.reportId,
      });
      return { skipped: true, reason: "row_not_found" };
    }

    if (row.embedding !== null) {
      // Already embedded — concurrent retries or backfill collision.
      return {
        skipped: true,
        reason: "already_embedded",
        reportId: data.reportId,
      };
    }

    if (!row.scrubbed_content || row.scrubbed_content.length < 40) {
      return {
        skipped: true,
        reason: "scrubbed_content_too_short",
        reportId: data.reportId,
      };
    }

    const text = buildEmbedText({
      scrubbed_content: row.scrubbed_content,
      scam_type: row.scam_type,
      channel: row.channel,
      impersonated_brand: row.impersonated_brand,
    });

    const domain = selectDomain(row.scam_type);

    const result = await step.run("embed", async () => {
      return await embed([text], { domain });
    });

    if (result.vectors.length !== 1) {
      throw new Error(
        `embed returned ${result.vectors.length} vectors for 1 input`,
      );
    }

    await step.run("write-embedding", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const { error } = await supabase
        .from("scam_reports")
        .update({
          embedding: vectorToPgString(result.vectors[0]),
          embedding_model_version: result.modelId,
        })
        .eq("id", data.reportId);

      if (error) {
        throw new Error(`write-embedding failed: ${error.message}`);
      }
    });

    await step.run("log-cost", () =>
      logCost({
        estimatedCostUsd: result.estimatedCostUsd,
        totalTokens: result.totalTokens,
        provider: result.provider,
        modelId: result.modelId,
        domain,
        reportId: data.reportId,
      }),
    );

    logger.info("scam-report-embed: complete", {
      reportId: data.reportId,
      modelId: result.modelId,
      domain,
      totalTokens: result.totalTokens,
    });

    return {
      reportId: data.reportId,
      modelId: result.modelId,
      domain,
      totalTokens: result.totalTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  },
);
