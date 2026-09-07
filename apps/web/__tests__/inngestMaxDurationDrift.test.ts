import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { PERSIST_BUDGET_MS } from "@askarthur/scam-engine/inngest/reddit-intel-cluster";

/**
 * The clustering write budget must track the route's declared maxDuration.
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
 *
 * WHAT THIS REPLACED, and why it matters. The first version of this guard
 * asserted only `PERSIST_BUDGET_MS < 300_000` — a THIRD copy of the same
 * number, which would still have passed if the route dropped to 60s, i.e. in
 * exactly the case the guard exists for. The commit message claimed the budget
 * was "derived from one number"; it was not. See docs/agents/defect-shapes.md
 * shape N — a guard asserting a proxy for the behaviour rather than the
 * behaviour.
 *
 * This reads the literal out of the route and enforces the relationship, so
 * changing either side alone goes red.
 */
describe("clustering budget tracks the Inngest route's maxDuration", () => {
  const routePath = path.join(
    __dirname,
    "..",
    "app",
    "api",
    "inngest",
    "route.ts",
  );

  it("finds the declared maxDuration (guards against a silently inert check)", () => {
    const src = fs.readFileSync(routePath, "utf8");
    expect(
      /export const maxDuration = \d+/.test(src),
      "app/api/inngest/route.ts no longer declares maxDuration — this guard " +
        "is inert and the clustering budget is unanchored.",
    ).toBe(true);
  });

  it("keeps the write budget at 80% of the declared route budget", () => {
    const src = fs.readFileSync(routePath, "utf8");
    const declared = Number(/export const maxDuration = (\d+)/.exec(src)![1]);

    expect(
      PERSIST_BUDGET_MS,
      `The route declares maxDuration = ${declared}s, so the clustering write ` +
        `budget should be ${Math.floor(declared * 1000 * 0.8)}ms but is ` +
        `${PERSIST_BUDGET_MS}ms.\n\nUpdate ROUTE_MAX_DURATION_S in ` +
        "packages/scam-engine/src/inngest/reddit-intel-cluster.ts to match. " +
        "The number exists twice by necessity; this test is what makes that safe.",
    ).toBe(Math.floor(declared * 1000 * 0.8));
  });

  it("leaves real headroom below the hard limit", () => {
    const src = fs.readFileSync(routePath, "utf8");
    const declared = Number(/export const maxDuration = (\d+)/.exec(src)![1]);
    // Headroom is the point: the wave in flight has to finish, the summary has
    // to be written, and the handler has to return, all inside the remainder.
    expect(PERSIST_BUDGET_MS).toBeLessThan(declared * 1000);
    expect(declared * 1000 - PERSIST_BUDGET_MS).toBeGreaterThan(30_000);
  });
});
