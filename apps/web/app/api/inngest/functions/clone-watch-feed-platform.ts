import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_WEAPONISED_EVENT } from "@askarthur/scam-engine/inngest/events";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import {
  feedCloneEntity,
} from "@/lib/clone-watch/feed-entity";

/**
 * Clone-Watch platform bridge — the third consumer on the escalation seam
 * `shopfront/clone.weaponised.v1` (alongside notify-weaponised and
 * enforcement-plan): a weaponised clone becomes a Platform Entity so the
 * platform's own surfaces act on it, not only the brand and Netcraft (#1151,
 * map #1143).
 *
 * WHY IT EXISTS. 147 weaponised clone domains, 0 in scam_entities, with the
 * feed flag ON in prod. The only writer was auto-triage's per-alert
 * feed-entity step behind `triage_status IS NULL`, and 136 of the 147 were
 * `tp_actioned` by the retrieve lane hours before auto-triage's 13:00 run —
 * so the bridge had never fired. Confirmed live phishing never reached the
 * extension, /api/v1/entities or /scam-map.
 *
 * WORKLIST-DRIVEN, NOT PAYLOAD-DRIVEN. The event is only a wake-up: the run
 * calls `list_clone_alerts_pending_platform_entity` (weaponised, not fp, not
 * yet stamped) and feeds up to FEED_BATCH_LIMIT rows. So a missed or
 * finish-cancelled run self-heals on the next weaponisation, and the one-off
 * backfill of the existing 149 is three fires of the manual trigger through
 * the SAME code path — no script. The function never reads `event.data`
 * (the working precedent: a payload parse ahead of the worklist is what threw
 * on every cron tick in #1107).
 *
 * The write is `feedCloneEntity` → v309 `feed_clone_platform_entity`: the
 * entity rows, the scam_urls row and the `submitted_to.platform_entity`
 * stamp are ONE transaction, so a fed row leaves the worklist atomically
 * (worklist-gate-starvation-rule). The RPC refuses non-weaponised / fp rows
 * itself; the worklist and the write agree on the predicate by construction.
 *
 * Cost: $0 — every row is an `internal` cost_telemetry entry so the lane is
 * visible on /admin/costs and to the silent-zero detector (#1145).
 */

// Bounded per run; the backlog is 149 today and ~5–20/week thereafter.
const FEED_BATCH_LIMIT = 50;
// In-step: ~4 RPC round-trips per row (feed + cost log), well under 60 s for
// 50 rows. Floor = 3 counted boundaries × 30 s + 60 s + 60 s = 210 s → 4 m
// (the quiet-path Outcome Row step is exclusive with the batch at runtime, but
// the budget guard counts step.run sites textually).
const FEED_WALL_CLOCK_MS = 60_000;

interface WorklistRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  inferred_target_domain: string | null;
  weaponised_at: string;
  triage_status: string | null;
}

export const cloneWatchFeedPlatform = inngest.createFunction(
  {
    id: "shopfront-clone-feed-platform",
    name: "Clone-Watch: feed weaponised clones to the platform (scam_entities + scam_urls)",
    retries: 2,
    // One at a time: a weaponisation burst fans in N events, and each run
    // drains the whole worklist, so concurrent runs would only contend on the
    // same rows' FOR UPDATE locks.
    concurrency: { limit: 1 },
    // 4m: 3 boundaries + the 60 s in-step wall clock + slack (ADR-0019;
    // inngestFinishBudgets.test.ts).
    timeouts: { finish: "4m" },
  },
  [
    { event: CLONE_WATCH_WEAPONISED_EVENT },
    { event: "shopfront/clone.feed-platform.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-feed-platform" },
    async ({ step }) => {
      if (!featureFlags.cloneWatchFeedEntities) {
        return {
          skipped: true,
          reason: "FF_CLONE_WATCH_FEED_ENTITIES disabled",
        };
      }

      const worklist = await step.run("load-worklist", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("supabase service client unavailable");
        const { data, error } = await sb.rpc(
          "list_clone_alerts_pending_platform_entity",
          { p_limit: FEED_BATCH_LIMIT },
        );
        if (error) {
          throw new Error(
            `list_clone_alerts_pending_platform_entity failed: ${error.message}`,
          );
        }
        return (data ?? []) as WorklistRow[];
      });

      if (worklist.length === 0) {
        // Quiet runs write their Outcome Row too (ADR-0025) — a burst of
        // weaponised events that finds an already-drained worklist is visible
        // as pool=0 rows, not as missing runs.
        await step.run("log-outcome-quiet", () =>
          recordLaneOutcome("shopfront-clone-feed-platform", 0, {
            pool: 0,
            written: 0,
          }),
        );
        return { ok: true, pool: 0, written: 0, notWritten: 0, failed: 0 };
      }

      const batch = await budgetedStep(
        step,
        "feed-batch",
        FEED_WALL_CLOCK_MS,
        async (budget) => {
          let written = 0;
          let notWritten = 0;
          let failed = 0;
          let cutOff = 0;
          const reasons: Record<string, number> = {};
          for (let i = 0; i < worklist.length; i++) {
            if (budget.expired()) {
              cutOff = worklist.length - i;
              break;
            }
            const row = worklist[i]!;
            try {
              const outcome = await feedCloneEntity({
                id: row.id,
                candidate_url: row.candidate_url,
              });
              if (outcome.kind === "written") {
                written++;
              } else {
                notWritten++;
                reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;
              }
            } catch (err) {
              failed++;
              logger.error("clone-watch feed-platform: row failed", {
                alertId: row.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          return { written, notWritten, failed, cutOff, reasons };
        },
      );

      // Per-run summary row (each write already logged its own `feed` row):
      // the shape the silent-zero detector reads is `pool > 0 ∧ written = 0`.
      await step.run("log-cost", () =>
        recordLaneOutcome("shopfront-clone-feed-platform", worklist.length, {
          pool: worklist.length,
          written: batch.written,
          not_written: batch.notWritten,
          failed: batch.failed,
          cut_off: batch.cutOff,
          reasons: batch.reasons,
        }),
      );

      // Rare, high-value: always-ship warn so the transition is in Axiom.
      if (batch.written > 0) {
        logger.warn("clone-watch: weaponised clones fed to the platform", {
          written: batch.written,
          pool: worklist.length,
        });
      }

      return {
        ok: true,
        pool: worklist.length,
        written: batch.written,
        notWritten: batch.notWritten,
        failed: batch.failed,
        cutOff: batch.cutOff,
      };
    },
  ),
);
