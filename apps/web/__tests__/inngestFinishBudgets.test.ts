import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #1069 — finish-timeout budgets must survive account-concurrency queueing.
 *
 * The Inngest Hobby plan gives the whole account 5 concurrent execution slots
 * (ADR-0019). Every `step.run` boundary re-queues for a slot, and when the
 * fleet's long inline-batch steps hold slots (post-v284/v285 they grew to
 * 40–200s each), a queued step measured ~30–60s of wait PER BOUNDARY
 * (2026-09-02, #1061). A `timeouts.finish` tuned for fast dispatch then
 * CANCELS healthy runs — and a cancellation gets no retries, no error, and no
 * telemetry. Measured damage before this guard existed: 44 of 51 preclassify
 * runs cancelled at exactly start+2m, 58% of the lane's cost telemetry lost,
 * urlscan-retrieve cancelled at exactly its 5m budget two days running, and
 * five weaponised brand alerts silently dropped by a 3m budget on a 15-step
 * function.
 *
 * The model here is deliberately a FLOOR, not a scheduler simulation:
 * static `step.run(` call sites × 30s of queue wait, plus any inline
 * wall-clock batch guard the file declares, plus 60s slack. Call sites in
 * mutually-exclusive branches overcount the real sequential path, and loop
 * bodies undercount it — 30s/site is the calibrated middle that made every
 * pre-#1069 casualty fail and every post-#1069 budget pass with headroom.
 * If this test fails on a new function, raise its finish budget (keep it
 * finite — it is still ADR-0019's circuit breaker), or genuinely reduce its
 * step count; do not loosen the coefficient.
 *
 * Verified go-red: against the pre-#1069 budgets this test fails for
 * preclassify (2m/4 steps), urlscan-retrieve (5m/4 steps + 200s batch),
 * urlscan-submit (5m/5 steps + 200s batch), notify-weaponised (3m/15 steps)
 * and report-summary (2m/4 steps).
 */

const FN_DIR = new URL("../app/api/inngest/functions/", import.meta.url);

const QUEUE_WAIT_SECONDS_PER_STEP = 30;
const SLACK_SECONDS = 60;

function requiredFinishSeconds(src: string): number {
  const stepSites = (src.match(/\bstep\.run(?:<[^>]*>)?\(/g) ?? []).length;
  const wallClockMs = [...src.matchAll(/_WALL_CLOCK_MS = ([\d_]+)/g)]
    .map((m) => Number(m[1].replaceAll("_", "")))
    .reduce((a, b) => a + b, 0);
  return (
    stepSites * QUEUE_WAIT_SECONDS_PER_STEP +
    wallClockMs / 1000 +
    SLACK_SECONDS
  );
}

function declaredFinishSeconds(src: string): number | null {
  const m = /timeouts:\s*\{[^}]*finish:\s*"(\d+)(m|s)"/.exec(src);
  if (!m) return null; // no finish timeout → cannot be cancelled by one
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

describe("Inngest finish budgets tolerate concurrency-queue waits", () => {
  const files = readdirSync(FN_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  expect(files.length).toBeGreaterThan(10);

  for (const file of files) {
    it(`${file} finish budget covers its step count`, () => {
      const src = readFileSync(new URL(file, FN_DIR), "utf8");
      const finish = declaredFinishSeconds(src);
      if (finish == null) return; // no finish timeout — nothing to breach
      const required = requiredFinishSeconds(src);
      expect(
        finish,
        `${file}: finish budget ${finish}s < floor ${required}s ` +
          `(${(src.match(/\bstep\.run(?:<[^>]*>)?\(/g) ?? []).length} step sites × ` +
          `${QUEUE_WAIT_SECONDS_PER_STEP}s queue wait + inline wall-clocks + ${SLACK_SECONDS}s slack). ` +
          `A too-small finish budget CANCELS healthy runs silently — see #1069.`,
      ).toBeGreaterThanOrEqual(required);
    });
  }
});
