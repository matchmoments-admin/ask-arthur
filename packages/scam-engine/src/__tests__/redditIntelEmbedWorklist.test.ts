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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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

  it("does not pace inside a step, and is sized so it need not", () => {
    // THE CORRECTION THIS TEST EXISTS FOR.
    //
    // The first version of chunking paced every call by 20s between provider
    // requests, by default. That sleep happens inside whatever calls it —
    // here, an Inngest step.run — holding one of five concurrency slots for
    // the whole wait. Measured against the real batch sizes of the other
    // callers:
    //
    //   acnc-charity-backfill-embed  200/batch -> 180s/step, up to 75 min/run
    //   scam-reports-backfill-embed  100/batch ->  80s/step, up to 67 min/run
    //
    // Long inline steps holding slots is the documented cause of a fleet-wide
    // run-cancellation incident here. Pacing by default would have traded a
    // rate-limit bug for that one.
    //
    // So pacing is opt-in and defaults to zero, and an Inngest job must not
    // opt in. Asserting "the default is 0" alone would go vacuous the moment
    // someone set the env var, so this asserts the property that actually
    // matters: THIS job never asks for a pause, and its batch is small enough
    // that it does not need one.
    expect(
      __testing.EMBED_CHUNK_PAUSE_MS_DEFAULT,
      "pacing must default to off — six of the seven embed() callers run " +
        "inside an Inngest step, where sleeping holds a concurrency slot",
    ).toBe(0);

    const src = readFileSync(SOURCE, "utf8");
    expect(
      src.includes("chunkPauseMs"),
      "this job opts into inter-chunk pacing. That sleep happens inside a " +
        "step.run and holds one of five Inngest slots. Bulk draining belongs " +
        "in scripts/_embed-backfill.ts, which holds no slot.",
    ).toBe(false);

    // Without pacing, the whole batch leaves as back-to-back requests, so the
    // batch must fit the provider's per-minute request allowance on its own.
    const VOYAGE_FREE_TIER_RPM = 3;
    const requests = Math.ceil(
      EMBED_ROWS_PER_RUN / __testing.EMBED_CHUNK_TEXTS,
    );
    expect(
      requests,
      `${EMBED_ROWS_PER_RUN} rows is ${requests} back-to-back provider ` +
        `requests, over the free tier's ${VOYAGE_FREE_TIER_RPM}/minute. ` +
        "Lower the batch rather than adding a pause — a pause here holds a slot.",
    ).toBeLessThanOrEqual(VOYAGE_FREE_TIER_RPM);
  });

  it("covers the steady-state daily volume in a single run", () => {
    // ~40 rows/day from the classifier. A per-run cap below that would grow a
    // permanent backlog, which is the problem this file exists about.
    expect(EMBED_ROWS_PER_RUN).toBeGreaterThanOrEqual(40);
  });
});

/**
 * The same defect appeared at consecutive stages of one pipeline. Guarding
 * only the two that were fixed, by name, would leave the next one to be
 * rediscovered the hard way — so this asserts the PROPERTY across every stage
 * that has a worklist: none may narrow it to the triggering event's cohort.
 */
describe("no pipeline stage scopes its worklist to the triggering cohort", () => {
  const STAGES = [
    {
      file: "../inngest/reddit-intel-embed.ts",
      step: 'step.run("load-unembedded"',
      worklist: "embedding IS NULL",
    },
    {
      file: "../inngest/reddit-intel-cluster.ts",
      step: 'step.run("load-state"',
      worklist: "theme_id IS NULL AND embedding IS NOT NULL",
    },
  ];

  for (const stage of STAGES) {
    const name = stage.file.split("/").pop();
    it(`${name} selects on work outstanding, not on the event`, () => {
      const src = readFileSync(new URL(stage.file, import.meta.url), "utf8");
      const start = src.indexOf(stage.step);
      expect(
        start,
        `${stage.step} not found in ${name} — renamed? this guard is inert`,
      ).toBeGreaterThan(-1);
      const body = stripComments(src.slice(start, src.indexOf("});", start)));

      for (const scoping of ["cohortStart", "cohortEnd"]) {
        expect(
          body.includes(scoping),
          `${name} narrows its worklist by ${scoping}. Its real worklist is ` +
            `"${stage.worklist}". Scoping to the triggering event means a row ` +
            "that misses its one window is orphaned permanently, because no " +
            "other job looks for it. That has already happened twice: 976 " +
            "rows unembedded, then the same 976 unclustered.",
        ).toBe(false);
      }
    });
  }
});

/**
 * A worklist that describes outstanding work is useless if the stage holding it
 * is never invoked.
 *
 * Three stages of this pipeline were fixed so their worklists select on work
 * outstanding rather than on the triggering event's cohort. The fourth instance
 * of the same mistake sat one level up: `reddit-intel-daily` returned at
 * `posts.length === 0` BEFORE emitting the event that triggers everything
 * downstream. So on a trigger with no new posts, nothing downstream ran at all.
 *
 * Measured before the fix: 1 of 4 daily triggers classified anything, so embed
 * and cluster were invoked about once a day, and 1,649 rows sat embedded and
 * unclustered while the cluster stage was perfectly able to see them.
 *
 * The property under test is therefore not about worklists at all: a stage that
 * fans out to another stage must emit its event on EVERY path, including the
 * one where it had no work of its own.
 */
describe("a stage with no work still invites the next stage", () => {
  it("reddit-intel-daily emits the cohort event on the no-new-posts path", () => {
    const src = readFileSync(
      new URL("../inngest/reddit-intel-daily.ts", import.meta.url),
      "utf8",
    );

    const guard = src.indexOf("if (posts.length === 0)");
    expect(
      guard,
      "the no-new-posts branch was not found — renamed? this guard is inert",
    ).toBeGreaterThan(-1);

    // The branch runs from its opening to its `return`. Everything the branch
    // does must happen before that return, so this is the window to check.
    const branch = stripComments(
      src.slice(guard, src.indexOf("return {", guard)),
    );

    expect(
      branch.includes("REDDIT_INTEL_SUMMARISED_EVENT"),
      "reddit-intel-daily returns on the no-new-posts path without emitting " +
        "REDDIT_INTEL_SUMMARISED_EVENT. Every downstream stage is triggered by " +
        "that event, so this short-circuits the whole pipeline: embed and " +
        "cluster never run, and their backlogs can only drain as a side effect " +
        "of new posts arriving. Emit the event and let each stage consult its " +
        "own worklist.",
    ).toBe(true);
  });

  it("says plainly that no model ran, rather than naming one", () => {
    // modelVersion is a free string in the schema, so the empty cohort could
    // silently carry the last real model id and pollute anything that groups
    // by it. The sentinel is greppable and cannot be mistaken for a model.
    const src = readFileSync(
      new URL("../inngest/reddit-intel-daily.ts", import.meta.url),
      "utf8",
    );
    const guard = src.indexOf("if (posts.length === 0)");
    const branch = src.slice(guard, src.indexOf("return {", guard));
    expect(branch).toContain("none:no-new-posts");
  });
});
