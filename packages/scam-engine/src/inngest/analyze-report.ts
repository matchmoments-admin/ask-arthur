import { inngest } from "./client";
import { logger } from "@askarthur/utils/logger";
import { storeScamReport, buildEntities } from "../report-store";
import {
  ANALYZE_COMPLETED_EVENT,
  SCAM_REPORT_STORED_EVENT,
  parseAnalyzeCompletedData,
} from "./events";
import type { InputMode, ReportSource } from "@askarthur/types";
import { withAxiomLogging } from "./with-axiom-logging";

// Durable consumer for analyze.completed.v1 — writes a scam_reports row
// plus entity links for every analysis, regardless of verdict.
//
// Idempotency:
//   - Function-level: `idempotency: "event.data.requestId"` prevents
//     duplicate executions if the same event is delivered twice.
//   - DB-level: scam_reports.idempotency_key partial unique index
//     (v73 migration) + `create_scam_report` RPC's ON CONFLICT clause
//     returns the original row id on collision. Belt-and-suspenders with
//     the Inngest-level dedup: if a function retries after a partial
//     write, the second call returns the same id without inserting.

export const handleAnalyzeCompletedReport = inngest.createFunction(
  {
    id: "analyze-completed-report",
    timeouts: { finish: "3m" },
    name: "Analyze: Persist scam report",
    idempotency: "event.data.requestId",
    retries: 3,
  },
  { event: ANALYZE_COMPLETED_EVENT },
  withAxiomLogging({ fnId: "analyze-completed-report" }, async ({ event, step }) => {
    // Parsed inline (not in a step.run): parseAnalyzeCompletedData is a pure,
    // deterministic Zod parse with no I/O, so memoising it as a durable step
    // bought nothing but cost one Inngest execution per analysis. Re-running it
    // on retry is free and yields identical output. (Was a "parse-event" step.)
    const data = parseAnalyzeCompletedData(event.data);

    if (!data.consumerFlags.intelligenceCore) {
      return { skipped: true, reason: "intelligenceCore flag off at emission" };
    }

    const entities = buildEntities({
      phones: data.consumerFlags.scamContactReporting
        ? data.scammerContacts?.phoneNumbers
        : undefined,
      emails: data.consumerFlags.scamContactReporting
        ? data.scammerContacts?.emailAddresses
        : undefined,
      urls: data.consumerFlags.scamUrlReporting ? data.urlResults : undefined,
      extractionMethod: data.imageCount > 0 ? "claude" : "regex",
    });

    const reportId = await step.run("store-scam-report", async () => {
      // storeScamReport is internally idempotent via the idempotencyKey
      // passthrough to create_scam_report. Safe to call on retry.
      const result = await storeScamReport({
        reporterHash: data.reporterHash,
        source: data.source as ReportSource,
        inputMode: (data.inputMode ?? null) as InputMode | null,
        analysis: {
          verdict: data.verdict,
          confidence: data.confidence,
          summary: data.summary,
          redFlags: data.redFlags,
          nextSteps: data.nextSteps,
          scamType: data.scamType,
          channel: data.channel,
          impersonatedBrand: data.impersonatedBrand,
          shopSignal: data.shopSignal,
        },
        text: data.text,
        region: data.region,
        countryCode: data.countryCode,
        verifiedScamId: null, // Phase 2b: set once verify consumer creates the verified_scams row
        entities,
        idempotencyKey: data.requestId,
      });

      if (result === null) {
        // storeScamReport swallows errors internally and returns null.
        // Throwing here lets Inngest retry per the `retries: 3` policy.
        throw new Error("storeScamReport returned null — retry");
      }

      return result;
    });

    logger.info("analyze.report.stored", {
      requestId: data.requestId,
      reportId,
      verdict: data.verdict,
      source: data.source,
      entityCount: entities.length,
    });

    // Emit a separate event so the embed consumer (scam-report-embed.ts)
    // can fail/retry independently of the row write. Skip for SAFE
    // verdicts and trivially-short content — neither carries useful
    // retrieval signal and the embed cost (small but non-zero) is wasted.
    const contentLength = data.text?.length ?? 0;
    if (data.verdict !== "SAFE" && contentLength >= 40) {
      await step.run("emit-scam-report-stored", () =>
        inngest.send({
          name: SCAM_REPORT_STORED_EVENT,
          // Inngest dedups events with the same id within 24h. Using the
          // reportId guarantees a single embed pass even if analyze-report
          // retries.
          id: `scam-report-stored-${reportId}`,
          data: {
            reportId,
            verdict: data.verdict,
            scamType: data.scamType ?? null,
            contentLength,
          },
        })
      );
    }

    return { reportId, entityCount: entities.length };
  })
);
