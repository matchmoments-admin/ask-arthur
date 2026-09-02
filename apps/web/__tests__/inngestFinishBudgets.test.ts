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
 * eighteen weaponised brand alerts silently dropped across two episodes.
 *
 * FLOOR = boundaries × 30s + inline wall-clock guards + 60s slack.
 *
 * **Counting boundaries is the whole difficulty, and this guard refuses to
 * guess it.** The first version of this test counted static `step.run(` call
 * sites, which undercounts every function whose step sites sit inside a
 * per-item loop: `clone-watch-auto-triage` has 3 sites in a 15-item loop = 45
 * runtime boundaries, and the test passed it at 3. A guard that reads as
 * protection while protecting nothing is worse than no guard, so when a file
 * shows either signal that static counting is wrong —
 *
 *   1. an INTERPOLATED step id (`step.run(\`fetch-${id}\`)`) — the marker of a
 *      per-item step inside a loop, whose count is a runtime cap the regex
 *      cannot read; or
 *   2. ZERO static step sites alongside a finish timeout — the steps live in a
 *      helper (e.g. onward-apwg → runUrlBlocklistOnward), invisible here;
 *
 * — the file must DECLARE its worst-case boundary count in a comment:
 *
 *   // inngest-finish-budget: <N> boundaries — <how N was derived>
 *
 * and the declared N is used. An undeclared file of either shape FAILS, with
 * the message telling the author to declare rather than silently passing on a
 * number nobody checked.
 *
 * Reducing N beats raising the budget: fold per-item steps into one batch step
 * (urlscan-retrieve/-submit are the reference shape) or add a wall-clock guard
 * that breaks the loop early and lets the tail drain next tick.
 *
 * Verified go-red: against the pre-#1069 budgets this fails for preclassify
 * (2m/4 steps), urlscan-retrieve (5m/4 steps + 200s batch), urlscan-submit
 * (5m/5 steps + 200s batch), notify-weaponised (3m/15 steps) and
 * report-summary (2m/4 steps); and against undeclared loop functions it fails
 * with the declaration message.
 */

const SCAN_DIRS = [
  new URL("../app/api/inngest/functions/", import.meta.url),
  // 19 registered functions with finish timeouts live here and contend for the
  // same 5 account slots — omitting them left the rule half-enforced.
  new URL("../../../packages/scam-engine/src/inngest/", import.meta.url),
];

const QUEUE_WAIT_SECONDS_PER_STEP = 30;
const SLACK_SECONDS = 60;

const STEP_SITE_RE = /\bstep\.run(?:<[^>]*>)?\(/g;
// `step.run(`name-${x}`)` — a template-literal id is how a per-item step in a
// loop gets a unique name, so it is the reliable marker for "count is a
// runtime cap, not a source count".
const INTERPOLATED_STEP_RE = /\bstep\.run(?:<[^>]*>)?\(\s*`[^`]*\$\{/;
const DECLARED_BOUNDARIES_RE = /inngest-finish-budget:\s*(\d+)\s*boundaries/;

function declaredFinishSeconds(src: string): number | null {
  const m = /timeouts:\s*\{[^}]*finish:\s*"(\d+)(m|s)"/.exec(src);
  if (!m) return null; // no finish timeout → cannot be cancelled by one
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

function wallClockSeconds(src: string): number {
  return (
    [...src.matchAll(/_WALL_CLOCK_MS\s*=\s*([\d_]+)/g)]
      .map((m) => Number(m[1].replaceAll("_", "")))
      .reduce((a, b) => a + b, 0) / 1000
  );
}

describe("Inngest finish budgets tolerate concurrency-queue waits", () => {
  const files = SCAN_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => ({ name: f, url: new URL(f, dir) })),
  );
  expect(files.length).toBeGreaterThan(10);

  for (const file of files) {
    it(`${file.name} finish budget covers its boundary count`, () => {
      const src = readFileSync(file.url, "utf8");
      const finish = declaredFinishSeconds(src);
      if (finish == null) return; // no finish timeout — nothing to breach

      const staticSites = (src.match(STEP_SITE_RE) ?? []).length;
      const declared = DECLARED_BOUNDARIES_RE.exec(src);
      const needsDeclaration =
        INTERPOLATED_STEP_RE.test(src) || staticSites === 0;

      if (needsDeclaration && !declared) {
        throw new Error(
          `${file.name}: has ${staticSites === 0 ? "no static step sites (steps live in a helper)" : "per-item step ids inside a loop"}, ` +
            `so counting \`step.run(\` call sites would UNDERCOUNT the runtime boundaries and pass a budget nobody checked. ` +
            `Declare the worst case in a comment: "inngest-finish-budget: <N> boundaries — <derivation>". ` +
            `Prefer reducing N (fold per-item steps into one batch step, or add a wall-clock guard) over raising the budget.`,
        );
      }

      const boundaries = declared ? Number(declared[1]) : staticSites;
      const required =
        boundaries * QUEUE_WAIT_SECONDS_PER_STEP +
        wallClockSeconds(src) +
        SLACK_SECONDS;

      expect(
        finish,
        `${file.name}: finish budget ${finish}s < floor ${required}s ` +
          `(${boundaries} boundaries${declared ? " (declared)" : ""} × ${QUEUE_WAIT_SECONDS_PER_STEP}s queue wait ` +
          `+ ${wallClockSeconds(src)}s inline wall-clocks + ${SLACK_SECONDS}s slack). ` +
          `A too-small finish budget CANCELS healthy runs silently — see #1069.`,
      ).toBeGreaterThanOrEqual(required);
    });
  }
});
