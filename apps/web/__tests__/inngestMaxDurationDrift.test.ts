import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  CLUSTER_BATCH_WALL_CLOCK_MS,
  NAMING_WALL_CLOCK_MS,
} from "@askarthur/scam-engine/inngest/reddit-intel-cluster";
import {
  IN_STEP_BUDGET_SHARE,
  MAX_IN_STEP_WALL_CLOCK_MS,
  ROUTE_MAX_DURATION_S,
} from "@askarthur/scam-engine/inngest/step-budget";

/**
 * Every in-step budget must fit inside the route's declared maxDuration.
 *
 * WHY THIS EXISTS. Exceeding `maxDuration` is not a slow run — Vercel kills the
 * request and Inngest reports "HTTP 504 before the SDK responded, no step
 * output was produced". That happened in prod on 2026-09-07. Since #1117 the
 * clustering load/match/write is ONE step, so a timeout loses the whole batch
 * and the retry times out identically.
 *
 * The number has to exist twice: scam-engine cannot import from apps/web
 * (wrong dependency direction), and Next.js requires `maxDuration` to be a
 * statically analysable literal, so it cannot be an imported const either.
 * Since #1130 the ONE scam-engine copy is `ROUTE_MAX_DURATION_S` in
 * step-budget.ts; every in-step budget derives from it through budgetedStep's
 * ceiling, which throws at runtime above 0.8 × maxDuration.
 *
 * WHAT THIS REPLACED, and why it matters. The first version of this guard
 * asserted only `PERSIST_BUDGET_MS < 300_000` — a THIRD copy of the same
 * number, which would still have passed if the route dropped to 60s, i.e. in
 * exactly the case the guard exists for. See docs/agents/defect-shapes.md
 * shape N. The second version enforced one constant; this one enforces the
 * copy AND sweeps every budgetedStep call site so a new in-step budget cannot
 * be declared above the ceiling without going red here as well as at runtime.
 *
 * Go-red: set ROUTE_MAX_DURATION_S to 299, or CLUSTER_BATCH_WALL_CLOCK_MS to
 * 300_000 — both fail.
 */
const routePath = path.join(
  __dirname,
  "..",
  "app",
  "api",
  "inngest",
  "route.ts",
);

const SCAN_DIRS = [
  path.join(__dirname, "..", "app", "api", "inngest", "functions"),
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

function declaredMaxDuration(): number {
  const src = fs.readFileSync(routePath, "utf8");
  const m = /export const maxDuration = (\d+)/.exec(src);
  expect(
    m,
    "app/api/inngest/route.ts no longer declares maxDuration — this guard is " +
      "inert and every in-step budget is unanchored.",
  ).not.toBeNull();
  return Number(m![1]);
}

describe("in-step budgets track the Inngest route's maxDuration", () => {
  it("keeps the scam-engine copy equal to the route's literal", () => {
    const declared = declaredMaxDuration();
    expect(
      ROUTE_MAX_DURATION_S,
      `The route declares maxDuration = ${declared}s but ` +
        `packages/scam-engine/src/inngest/step-budget.ts says ${ROUTE_MAX_DURATION_S}. ` +
        "The number exists twice by necessity; this test is what makes that safe.",
    ).toBe(declared);
  });

  it("derives the ceiling from that copy and leaves real headroom", () => {
    const declared = declaredMaxDuration();
    expect(MAX_IN_STEP_WALL_CLOCK_MS).toBe(
      Math.floor(declared * 1000 * IN_STEP_BUDGET_SHARE),
    );
    // The wave in flight has to finish, the step output has to be written,
    // and the handler has to return, all inside the remainder.
    expect(declared * 1000 - MAX_IN_STEP_WALL_CLOCK_MS).toBeGreaterThan(30_000);
  });

  it("keeps the known in-step budgets at or under the ceiling", () => {
    expect(CLUSTER_BATCH_WALL_CLOCK_MS).toBeLessThanOrEqual(
      MAX_IN_STEP_WALL_CLOCK_MS,
    );
    expect(NAMING_WALL_CLOCK_MS).toBeLessThanOrEqual(MAX_IN_STEP_WALL_CLOCK_MS);
  });

  it("no in-step provider timeout can outlive the request that carries it", () => {
    // #1134. reddit-intel-daily declared CLASSIFY_TIMEOUT_MS = 360_000 for a
    // Claude call made inside a step.run. Every Inngest step executes as ONE
    // HTTP request to a route that declares maxDuration = 300, so a 360s
    // budget could never fire: Vercel killed the request 60s first and the
    // failure arrived as "HTTP 504 before the SDK responded, no step output
    // was produced" — no attribution, no error row, three retries of a full
    // 300s slot hold. Same shape as the #1124 wall-clock guards: a number
    // describing protection the surrounding budget made impossible.
    //
    // WHAT THIS DOES NOT CATCH (house style, docs/agents/defect-shapes.md): a
    // timeout constant declared OUTSIDE these two directories and imported in
    // — TAKE_TIMEOUT_MS in reddit-intel/take-writer.ts is one, currently 240s
    // and therefore fine. It also cannot resolve a computed value.
    //
    // Go-red: restore CLASSIFY_TIMEOUT_MS = 360_000.
    const declared = declaredMaxDuration() * 1000;
    const offenders: string[] = [];
    let seen = 0;
    for (const dir of SCAN_DIRS) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
        if (f.endsWith(".test.ts")) continue;
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        for (const m of src.matchAll(
          /const\s+(\w*_TIMEOUT_MS)\s*=\s*([\d_]+)\s*;/g,
        )) {
          seen++;
          const ms = Number(m[2]!.replaceAll("_", ""));
          if (ms >= declared) {
            offenders.push(
              `${f}: ${m[1]} = ${ms}ms >= maxDuration ${declared}ms`,
            );
          }
        }
      }
    }
    expect(
      seen,
      "found no *_TIMEOUT_MS declarations — sweep is inert",
    ).toBeGreaterThan(3);
    expect(
      offenders,
      "These timeouts are inside a step.run but outlive the request that " +
        "carries it, so they can never fire:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nVercel kills the request at maxDuration first, producing a 504 " +
        "with no step output and no attribution.",
    ).toEqual([]);
  });

  it("every budgetedStep call site passes a same-file literal under the ceiling", () => {
    // budgetedStep throws above the ceiling at runtime; this catches it at
    // test time, and refuses a budget it cannot resolve rather than passing a
    // number nobody checked.
    const sites: string[] = [];
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
        if (f.endsWith(".test.ts") || f === "step-budget.ts") continue;
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        for (const m of src.matchAll(
          /budgetedStep\(\s*step,\s*"([^"]+)",\s*(\w+)/g,
        )) {
          const [, stepName, ident] = m;
          sites.push(`${f}:${stepName}`);
          const lit = new RegExp(`const ${ident} = ([\\d_]+);`).exec(src);
          if (!lit) {
            offenders.push(
              `${f} step "${stepName}": budget ${ident} is not a numeric literal in the same file — declare it as one (inngestFinishBudgets sums *_WALL_CLOCK_MS literals)`,
            );
            continue;
          }
          const ms = Number(lit[1]!.replaceAll("_", ""));
          if (ms > MAX_IN_STEP_WALL_CLOCK_MS) {
            offenders.push(
              `${f} step "${stepName}": ${ident} = ${ms}ms > ceiling ${MAX_IN_STEP_WALL_CLOCK_MS}ms`,
            );
          }
          if (!ident.endsWith("_WALL_CLOCK_MS")) {
            offenders.push(
              `${f} step "${stepName}": ${ident} must end in _WALL_CLOCK_MS or the finish-budget floor cannot see it`,
            );
          }
        }
      }
    }
    // Two in reddit-intel-cluster as of #1130; a sweep that finds none is inert.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });
});
