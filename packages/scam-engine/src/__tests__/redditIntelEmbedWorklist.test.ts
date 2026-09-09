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
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { __testing } from "../embeddings";
import { EMBED_ROWS_PER_RUN } from "../inngest/reddit-intel-embed";
import {
  parseRedditIntelEmbeddedData,
  parseRedditIntelSummarisedData,
  resolveRedditIntelEmbeddedData,
  resolveRedditIntelSummarisedData,
} from "../inngest/events";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SOURCE = new URL("../inngest/reddit-intel-embed.ts", import.meta.url);

/** The load-unembedded step body, comments stripped. */
function worklistSource(): string {
  const src = readFileSync(SOURCE, "utf8");
  const start = src.indexOf('step.run("load-unembedded"');
  expect(
    start,
    "load-unembedded step not found — was it renamed?",
  ).toBeGreaterThan(-1);
  const end = src.indexOf("});", start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * Locate a step site by NAME whether it is `step.run("name"` or
 * `budgetedStep(step, "name"` (the in-step Step Budget constructor, #1130).
 * `step "name"` in a stage entry means "the step called name".
 */
function stepSite(src: string, anchor: string): number {
  const m = /^step "([^"]+)"$/.exec(anchor);
  if (!m) return src.indexOf(anchor);
  const re = new RegExp(
    `\\b(?:step\\.run|budgetedStep)\\(\\s*(?:step,\\s*)?"${m[1]}"`,
  );
  return src.search(re);
}

describe("reddit-intel-embed worklist", () => {
  it("selects on embedding IS NULL", () => {
    // The actual worklist predicate: rows that need work, not rows that
    // belong to a particular event.
    expect(worklistSource()).toContain('.is("embedding", null)');
  });

  it("is not narrowed to the triggering cohort", () => {
    const body = worklistSource();
    for (const scoping of [
      "cohortStart",
      "cohortEnd",
      'gte("processed_at"',
      'lt("processed_at"',
    ]) {
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
    expect(worklistSource()).toContain("ascending: true");
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
      // Since #1130 this is a budgetedStep, not a bare step.run — the anchor
      // is the step NAME, found via STEP_SITE below, so a change of
      // constructor cannot silently make this guard inert.
      step: 'step "cluster-batch"',
      worklist: "theme_id IS NULL AND embedding IS NOT NULL",
    },
  ];

  for (const stage of STAGES) {
    const name = stage.file.split("/").pop();
    it(`${name} selects on work outstanding, not on the event`, () => {
      const src = readFileSync(new URL(stage.file, import.meta.url), "utf8");
      const start = stepSite(src, stage.step);
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
  /**
   * The property, over every stage that fans out — not over the one stage I
   * happened to fix first.
   *
   * reddit-intel-daily returned at `posts.length === 0` before emitting the
   * event that triggers reddit-intel-embed. I fixed that, wrote a guard for
   * it, and claimed the pipeline was unblocked. It was not:
   * reddit-intel-embed had the IDENTICAL shape one stage down, returning at
   * `rows.length === 0` before emitting the event that triggers
   * reddit-intel-cluster. A guard naming only the first stage would not have
   * caught the second, which is exactly how the fourth instance of this
   * pattern hid behind the three before it.
   *
   * So the cases are a table, and adding a stage to the chain means adding a
   * row here.
   */
  const FANOUT_STAGES = [
    {
      file: "../inngest/reddit-intel-daily.ts",
      guard: "if (posts.length === 0)",
      emits: "REDDIT_INTEL_SUMMARISED_EVENT",
      starves: "reddit-intel-embed",
    },
    {
      file: "../inngest/reddit-intel-embed.ts",
      guard: "if (rows.length === 0)",
      emits: "REDDIT_INTEL_EMBEDDED_EVENT",
      starves: "reddit-intel-cluster",
    },
  ];

  for (const stage of FANOUT_STAGES) {
    const name = stage.file.split("/").pop();
    it(`${name} emits on its no-work path`, () => {
      const src = readFileSync(new URL(stage.file, import.meta.url), "utf8");
      const at = src.indexOf(stage.guard);
      expect(
        at,
        `"${stage.guard}" not found in ${name} — renamed? this guard is inert`,
      ).toBeGreaterThan(-1);

      // The branch runs from its opening to its `return`; everything it does
      // must happen before that.
      const branch = stripComments(src.slice(at, src.indexOf("return {", at)));

      expect(
        branch.includes(stage.emits),
        `${name} returns on its no-work path without emitting ${stage.emits}. ` +
          `${stage.starves} is triggered only by that event, so this starves ` +
          "it on every tick where this stage had nothing of its own to do — " +
          "and its backlog can then only drain as a side effect of upstream " +
          "work. Emit, and let the next stage consult its own worklist.",
      ).toBe(true);
    });
  }

  it("says plainly that no model ran, rather than naming one", () => {
    // modelVersion is a free string, so an empty cohort could silently carry
    // the last real model id and pollute anything grouping by it.
    const src = readFileSync(
      new URL("../inngest/reddit-intel-daily.ts", import.meta.url),
      "utf8",
    );
    const at = src.indexOf("if (posts.length === 0)");
    expect(src.slice(at, src.indexOf("return {", at))).toContain(
      "none:no-new-posts",
    );
  });
});

/**
 * Belt and braces, chosen deliberately.
 *
 * The emits above keep the chain responsive inside a single trigger. The crons
 * below guarantee the backlog drains even if no upstream stage produces
 * anything at all — which matters because the Vercel trigger route ALSO
 * returns without dispatching when everything is already classified, and it
 * structurally cannot do otherwise: RedditIntelBatchReadyDataSchema declares
 * `feedItemIds` as `.min(1)`, so an empty batch cannot be emitted.
 *
 * Without a cron, that route's gate silently caps the whole pipeline at
 * "whatever new posts happened to arrive".
 */
describe("the drain stages do not depend on being invited", () => {
  const CRON_STAGES = [
    "../inngest/reddit-intel-embed.ts",
    "../inngest/reddit-intel-cluster.ts",
  ];

  for (const file of CRON_STAGES) {
    const name = file.split("/").pop();
    it(`${name} has its own cron trigger`, () => {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(
        /\{\s*cron:\s*"/.test(src),
        `${name} is triggered only by an upstream event, so its backlog can ` +
          "only drain when something upstream produced work. Add a cron " +
          "trigger alongside the event — the repo idiom is " +
          "[{ cron }, { event }], as in scam-reports-backfill-embed.",
      ).toBe(true);
    });

    it(`${name} delegates payload resolution instead of inlining a fallback`, () => {
      // Deliberately NOT asserting how the stage discriminates — that is the
      // mistake this replaced. The stage must not carry its own fallback
      // literal; the one in events.ts is behaviourally tested below.
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(
        src.includes("none:cron-sweep"),
        `${name} inlines its own cron fallback. Two copies of this decision ` +
          "is how #1107 shipped a truthiness test in one of them. Call the " +
          "resolver in events.ts instead.",
      ).toBe(false);
    });
  }

  it("keeps the cron off the top of the hour", () => {
    // ADR-0019: "Prefer off-:00 minutes for new crons. The top of the hour is
    // the fleet's worst pileup."
    for (const file of CRON_STAGES) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      const m = src.match(/\{\s*cron:\s*"(\d+)\s/);
      expect(m, `${file} has no parseable cron minute`).not.toBeNull();
      expect(Number(m![1]), `${file} fires on the hour`).toBeGreaterThan(0);
    }
  });
});

/**
 * The cron payload, exercised rather than grepped.
 *
 * #1107 shipped `event?.data ? parse(event.data) : fallback` in both drain
 * stages, guarded by a test asserting the STRING "event?.data" was present.
 * The string was present. The code was broken: Inngest's cron tick is not an
 * empty payload, it is its own internal event carrying `data: { cron }` —
 *
 *     type ScheduledTimerEventPayload = … & {
 *       name: `${internalEvents.ScheduledTimer}`;
 *       data: { cron: string };        // node_modules/inngest/types.d.ts
 *     }
 *
 * — which is truthy, so every scheduled run took the parse branch and threw on
 * the missing required fields. Four failures per tick, in both stages, found by
 * a Telegram page rather than by CI.
 *
 * The first assertion in each case is the CONTROL: it pins the fact that made
 * the old code fatal. If Inngest ever starts sending a payload the schema
 * accepts, that control goes red and this comment stops being true.
 */
describe("a cron tick resolves to a sweep cohort, not an exception", () => {
  const CRON_PAYLOAD = { cron: "25 2,8,14,20 * * *" };

  it("control: the strict parse throws on Inngest's cron payload", () => {
    expect(() => parseRedditIntelSummarisedData(CRON_PAYLOAD)).toThrow();
    expect(() => parseRedditIntelEmbeddedData(CRON_PAYLOAD)).toThrow();
  });

  it("resolves a cron payload to the sweep sentinel", () => {
    const summarised = resolveRedditIntelSummarisedData(CRON_PAYLOAD);
    expect(summarised.modelVersion).toBe("none:cron-sweep");
    expect(summarised.postsClassified).toBe(0);
    expect(summarised.cohortDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const embedded = resolveRedditIntelEmbeddedData(CRON_PAYLOAD);
    expect(embedded.modelId).toBe("none:cron-sweep");
    expect(embedded.postsEmbedded).toBe(0);
    expect(embedded.embeddingProvider).toBe("voyage");
  });

  it("resolves an absent payload the same way", () => {
    // `event?.data` is undefined when the function object is invoked without
    // an event at all — the case the original code believed was the only one.
    expect(resolveRedditIntelSummarisedData(undefined).modelVersion).toBe(
      "none:cron-sweep",
    );
    expect(resolveRedditIntelEmbeddedData(undefined).modelId).toBe(
      "none:cron-sweep",
    );
  });

  it("passes a real upstream payload through untouched", () => {
    // The fallback must not swallow a genuine event: if it did, every cohort
    // would silently become a sweep and the bug would invert.
    const real = {
      cohortDate: "2026-09-07",
      postsClassified: 42,
      newQuotesCount: 7,
      modelVersion: "claude-sonnet-4-6",
    };
    expect(resolveRedditIntelSummarisedData(real)).toEqual(real);

    const realEmbedded = {
      cohortDate: "2026-09-07",
      postsEmbedded: 60,
      embeddingProvider: "voyage" as const,
      modelId: "voyage-3.5",
    };
    expect(resolveRedditIntelEmbeddedData(realEmbedded)).toEqual(realEmbedded);
  });
});

/**
 * Vectors must not cross a step boundary.
 *
 * An Inngest step's return value is serialised and durably stored, against a
 * 4 MB limit. Clustering handles 1024-dimension vectors: 500 posts plus 200
 * themes is ~19.5 MB, so when `load-state` returned `{ posts, themes }` for
 * assignment in a LATER step, the function failed `output_too_large` on every
 * run and the backlog it exists to drain grew instead (prod, 2026-09-06/07).
 *
 * The ceiling is not a function of batch size alone — 200 themes on their own
 * are ~3.9 MB, so the split-step shape could not have survived theme growth at
 * any batch size. The invariant is therefore about CO-LOCATION, not size: the
 * load, the match and the write belong in one step so the vectors stay in
 * memory and only scalars are returned.
 *
 * WHAT THIS DOES NOT CATCH: a future step elsewhere in the file that selects an
 * embedding column and returns it. This asserts the three stay together, not
 * that no vector is ever returned anywhere — see docs/agents/defect-shapes.md
 * shape N on the limits of source-level guards.
 */
describe("clustering keeps its vectors inside one step", () => {
  const file = "../inngest/reddit-intel-cluster.ts";

  it("loads, assigns and persists within the same step.run", () => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const start = stepSite(src, 'step "cluster-batch"');
    expect(
      start,
      "cluster-batch step not found — renamed? this guard is inert",
    ).toBeGreaterThan(-1);

    // The step body ends where the NEXT step begins; using the next step
    // site as the terminator avoids trying to brace-match a 150-line callback.
    const rest = src.slice(start + 10);
    const next = rest.search(/\b(step\.run|budgetedStep)\(/);
    const body =
      next > -1 ? src.slice(start, start + 10 + next) : src.slice(start);

    for (const call of ["assignPostsToThemes(", "persistAssignments("]) {
      expect(
        body.includes(call),
        `${call} is no longer inside the cluster-batch step. Moving it out ` +
          "means the 1024-dim vectors it needs must be RETURNED from the " +
          "step — ~19.5 MB against Inngest's 4 MB step-output limit, which " +
          "fails every run as output_too_large.",
      ).toBe(true);
    }
  });
});

/**
 * No dual-trigger function may discriminate its payload by truthiness.
 *
 * A cron tick is not an absent payload. Inngest sends its own internal event
 * carrying `data: { cron: string }` (node_modules/inngest/types.d.ts), which is
 * TRUTHY — so `event?.data ? parseX(event.data) : fallback` takes the parse
 * branch on every scheduled run and throws on the required fields. #1107
 * shipped exactly that into two stages; both failed four times per tick for two
 * days.
 *
 * A fleet sweep on 2026-09-07 found 24 dual-trigger functions and no other
 * instance — 17 destructure only `{ step }`, five read `event` defensively with
 * optional chaining, one discriminates on `event.name`. This guard exists
 * because four of them carry comments instructing a future maintainer to
 * re-add a cron alongside their event trigger (enrich-vulnerability,
 * scam-alerts, onward-auto-report, regulator-alert-push): each is one line away
 * from becoming dual-trigger, and the bug reappears the moment one does.
 *
 * WHAT THIS DOES NOT CATCH: a truthiness test written across several lines, or
 * one hidden behind a helper. It is a source sweep, with the limits described
 * in docs/agents/defect-shapes.md shape N — which is why the resolvers it
 * steers people toward are themselves behaviourally tested above.
 */
describe("no dual-trigger function truthiness-tests its payload", () => {
  const dirs = [
    path.join(__dirname, "..", "inngest"),
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "apps",
      "web",
      "app",
      "api",
      "inngest",
      "functions",
    ),
  ];

  const files = dirs.flatMap((d) =>
    fs.existsSync(d)
      ? fs
          .readdirSync(d)
          .filter((f) => f.endsWith(".ts"))
          .map((f) => path.join(d, f))
      : [],
  );

  it("finds the Inngest function directories (guards a silently-empty sweep)", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("has no `event?.data ?` ternary in a function that also has a cron", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Comments stripped FIRST. The first version of this guard flagged its
      // own docblock, and flagged `event.data?.identifier` — optional chaining,
      // not a ternary — because `[^?]` excludes `??` but not `?.`. Matching
      // text rather than code is the very shape this file is about.
      const src = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((l) => l.replace(/\/\/[^\n]*/g, " "))
        .join("\n");
      if (!/\{\s*cron:\s*"/.test(src)) continue; // event-only: a payload is guaranteed
      if (/event\??\.data\s*\?(?![?.])/.test(src)) {
        offenders.push(path.basename(file));
      }
    }
    expect(
      offenders,
      "These functions have BOTH a cron trigger and a truthiness test on " +
        "event.data:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nA cron tick carries `data: { cron }` — truthy — so the parse " +
        "branch runs and throws on every scheduled run.\nUse safeParse (see " +
        "resolveRedditIntelSummarisedData in inngest/events.ts) or isCronTick " +
        "from inngest/with-axiom-logging.ts.",
    ).toEqual([]);
  });
});
