import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A wall-clock guard must measure from something that survives replay.
 *
 * WHAT THIS COST. Four clone-watch functions each declared a `*_WALL_CLOCK_MS`
 * budget, captured `const xStartMs = Date.now()` in the handler body, and broke
 * out of a loop when `Date.now() - xStartMs` exceeded it. Every one of those
 * loops awaits `step.run` per item, so it spans step boundaries — and Inngest
 * re-executes the handler FROM THE TOP at each boundary. The timestamp reset on
 * every replay, so the elapsed value never grew and none of the four guards
 * could ever fire. Each carried a detailed comment describing the protection it
 * was not providing (measured 2026-09-07).
 *
 * It is the same defect as `fn.complete.durationMs`, which reported avg=1ms for
 * runs observed taking minutes (#1120).
 *
 * THE DISTINCTION THIS ENCODES, because getting it wrong nearly caused four
 * correct numbers to be "fixed":
 *
 *   - A guard whose loop sits INSIDE one step.run is bounded by the route's
 *     `maxDuration` (a single HTTP request). It obtains its budget from
 *     `budgetedStep`, whose clock starts at step entry by construction —
 *     see reddit-intel-cluster, covered by inngestMaxDurationDrift.test.ts.
 *   - A guard whose loop SPANS step boundaries is bounded by the function's
 *     `timeouts.finish` (the whole run), NOT by maxDuration — which is why
 *     420_000ms against a 12m finish is correct, not a bug. It obtains its
 *     budget from `spanningBudget`, whose clock is `event.ts`.
 *
 * Both constructors live in @askarthur/scam-engine/inngest/step-budget.
 *
 * WHAT THIS DOES NOT CATCH: a guard that spans boundaries using some third
 * replay-unsafe source this pattern does not match. It asserts the absence of
 * the one shape that has actually bitten — see docs/agents/defect-shapes.md
 * shape N on the limits of source-level guards.
 */
const FN_DIRS = [
  path.join(__dirname, "..", "app", "api", "inngest", "functions"),
  // Extended to scam-engine in #1135. Both backfill embedders declare a
  // spanning budget there, and half a sweep is how a rule quietly becomes
  // optional: the apps/web-only version could not see them at all.
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "scam-engine",
    "src",
    "inngest",
  ),
];

const files = FN_DIRS.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f)),
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/[^\n]*/g, " "))
    .join("\n");
}

describe("wall-clock guards survive Inngest step replay", () => {
  it("finds the function directory (guards a silently-empty sweep)", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("no guard compares against a timestamp captured in the handler body", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (!/_WALL_CLOCK_MS\s*=/.test(src)) continue;
      // The broken shape: `Date.now() - <someLocal> > <BUDGET>`.
      const m = src.match(/Date\.now\(\)\s*-\s*\w+\s*>\s*\w*_WALL_CLOCK_MS/);
      if (m) offenders.push(`${path.basename(file)}  ${m[0]}`);
    }
    expect(
      offenders,
      "These wall-clock guards measure from a timestamp taken in the handler " +
        "body:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nInngest re-executes the handler at every step boundary, so that " +
        "value resets\non each replay and the guard can never fire. If the " +
        "guarded loop awaits step.run,\nuse elapsedSinceTrigger({ event }) " +
        "from @askarthur/scam-engine/inngest/with-axiom-logging,\nwhich reads " +
        "event.ts and survives replay. If the loop is wholly inside ONE " +
        "step.run,\na local timestamp is correct — say so in a comment.",
    ).toEqual([]);
  });

  it("no guard turns an unknowable elapsed time back into a confident zero", () => {
    // elapsedSinceTrigger returns null when event.ts is unusable — its docblock
    // says a confident zero is the failure mode the whole change is about. The
    // first conversion of the four clone-watch guards then wrote
    // `elapsedSinceTrigger({ event }) ?? 0` at every site, so on such a run the
    // guard could never fire: the exact pre-#1124 behaviour, behind a comment
    // describing the fix. Go-red: reinstating `?? 0` at any site fails this.
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      const m = src.match(/elapsedSinceTrigger\([^)]*\)\s*\?\?\s*0\b/);
      if (m) offenders.push(`${path.basename(file)}  ${m[0]}`);
    }
    expect(
      offenders,
      "These guards coerce a null elapsed time to 0, so they never fire when " +
        "event.ts is unusable:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nDegrade to a segment clock and warn once instead — or use " +
        "spanningBudget from @askarthur/scam-engine/inngest/step-budget.",
    ).toEqual([]);
  });

  it("every declared budget is consumed through a Step Budget constructor", () => {
    // A `*_WALL_CLOCK_MS` constant with no spanningBudget(/budgetedStep( in
    // the same file is a number that bounds nothing — or one wired to a local
    // Date.now() that the first assertion may not match. Go-red: rename the
    // spanningBudget( call in any clone-watch file.
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (!/_WALL_CLOCK_MS\s*=/.test(src)) continue;
      if (!/\b(spanningBudget|budgetedStep)\(/.test(src)) {
        offenders.push(path.basename(file));
      }
    }
    expect(
      offenders,
      "These files declare a *_WALL_CLOCK_MS budget but never construct a " +
        "Step Budget from it:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nUse spanningBudget({ event }, X_WALL_CLOCK_MS, logger) for a loop " +
        "that awaits step.run,\nor budgetedStep(step, name, X_WALL_CLOCK_MS, fn) " +
        "for work inside one step.",
    ).toEqual([]);
  });

  it("every declared budget fits inside its own finish timeout", () => {
    // A guard spanning step boundaries is bounded by timeouts.finish, not by
    // the route's maxDuration. Asserting it against maxDuration would flag four
    // correct budgets — which is exactly the wrong conclusion I reached first.
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const budget = /_WALL_CLOCK_MS\s*=\s*([\d_]+)/.exec(src);
      if (!budget) continue;
      const finish = /finish:\s*"(\d+)m"/.exec(src);
      if (!finish) {
        offenders.push(`${path.basename(file)}: budget but no finish timeout`);
        continue;
      }
      const budgetMs = Number(budget[1]!.replace(/_/g, ""));
      const finishMs = Number(finish[1]) * 60_000;
      if (budgetMs >= finishMs) {
        offenders.push(
          `${path.basename(file)}: budget ${budgetMs}ms >= finish ${finishMs}ms`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
