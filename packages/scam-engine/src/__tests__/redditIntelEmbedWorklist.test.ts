/**
 * Two properties of the embed job that nothing else can check.
 *
 * The first is that its worklist is not scoped to the triggering event's
 * cohort. It used to be — `processed_at` within 24h of the cohort date, AND
 * embedding IS NULL — which made the worklist a function of which EVENT fired
 * rather than of which rows need work. A row that missed its one window was
 * orphaned permanently, because nothing else anywhere looks for
 * `embedding IS NULL`.
 *
 * That is not hypothetical. A corpus backfill made one cohort 500 rows,
 * `embed()` sent all 500 in a single request, Voyage's free tier 429'd,
 * Inngest exhausted three retries on the same oversized request, and the
 * event was consumed. 976 rows were left unembedded and no future run would
 * ever have looked at them.
 *
 * The second is the batch size, which is bounded by something less obvious
 * than the API: the pacing happens inside a step.run, holding an Inngest
 * concurrency slot. On a 5-slot plan, long inline steps holding slots is the
 * documented cause of a previous fleet-wide cancellation incident. So the
 * ceiling is computed from the real constants rather than asserted as a
 * number, and it fails if anyone raises the batch without doing the sums.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { __testing } from "../embeddings";
import { EMBED_ROWS_PER_RUN } from "../inngest/reddit-intel-embed";

const SOURCE = new URL("../inngest/reddit-intel-embed.ts", import.meta.url);

/** The load-unembedded step body, comments stripped. */
function worklistSource(): string {
  const src = readFileSync(SOURCE, "utf8");
  const start = src.indexOf('step.run("load-unembedded"');
  expect(start, "load-unembedded step not found — was it renamed?").toBeGreaterThan(-1);
  const end = src.indexOf("});", start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("reddit-intel-embed worklist", () => {
  it("selects on embedding IS NULL", () => {
    // The actual worklist predicate: rows that need work, not rows that
    // belong to a particular event.
    expect(worklistSource()).toContain('.is("embedding", null)');
  });

  it("is not narrowed to the triggering cohort", () => {
    const body = worklistSource();
    for (const scoping of ["cohortStart", "cohortEnd", 'gte("processed_at"', 'lt("processed_at"']) {
      expect(
        body.includes(scoping),
        `the worklist filters on ${scoping} again. That makes it a function ` +
          "of which event fired rather than which rows need work, and any row " +
          "missing its one window is orphaned forever — nothing else sweeps " +
          "for embedding IS NULL.",
      ).toBe(false);
    }
  });

  it("drains oldest first so a backlog cannot starve behind new arrivals", () => {
    expect(worklistSource()).toContain('ascending: true');
  });

  it("keeps one run inside the route budget AND the Inngest slot budget", () => {
    // maxDuration on apps/web/app/api/inngest/route.ts. Hard-coded here
    // because scam-engine cannot import from the web app; the comment on
    // EMBED_ROWS_PER_RUN names it too.
    const ROUTE_MAX_DURATION_MS = 300_000;
    // A slot held this long on a 5-slot plan starves the rest of the fleet.
    const SLOT_HOLD_BUDGET_MS = 120_000;

    const chunks = Math.ceil(EMBED_ROWS_PER_RUN / __testing.EMBED_CHUNK_TEXTS);
    const pacingMs = Math.max(0, chunks - 1) * __testing.EMBED_CHUNK_PAUSE_MS;

    expect(
      pacingMs,
      `${EMBED_ROWS_PER_RUN} rows is ${chunks} provider requests and ` +
        `${pacingMs / 1000}s of pacing, which exceeds the route's ` +
        `${ROUTE_MAX_DURATION_MS / 1000}s maxDuration.`,
    ).toBeLessThan(ROUTE_MAX_DURATION_MS);

    expect(
      pacingMs,
      `${pacingMs / 1000}s of pacing happens INSIDE a step.run, holding one ` +
        "of five Inngest concurrency slots for that entire time. Long inline " +
        "steps holding slots is the documented cause of a fleet-wide " +
        "run-cancellation incident. Drain a backlog with " +
        "scripts/_embed-backfill.ts, which holds no slot.",
    ).toBeLessThan(SLOT_HOLD_BUDGET_MS);
  });

  it("covers the steady-state daily volume in a single run", () => {
    // ~40 rows/day from the classifier. A per-run cap below that would grow a
    // permanent backlog, which is the problem this file exists about.
    expect(EMBED_ROWS_PER_RUN).toBeGreaterThanOrEqual(40);
  });
});
