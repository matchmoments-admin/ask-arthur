import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INNGEST_PLAN_MAX_BATCH_SIZE,
  INNGEST_PLAN_MAX_BATCH_TIMEOUT_S,
  PRECLASSIFY_BATCH_SIZE,
  PRECLASSIFY_BATCH_TIMEOUT,
} from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";

/**
 * Inngest REJECTS a function whose batchEvents.maxSize exceeds the account
 * plan's ceiling — and one rejected function fails the WHOLE app sync
 * (`modified:false`): no function change registers anywhere. #1190 shipped
 * maxSize 50 against a ceiling of 5 and the post-deploy resync 400'd
 * (2026-09-24). This pins every batchEvents config under the ceiling.
 */
const DIRS = [
  join(process.cwd(), "app/api/inngest/functions"),
  join(process.cwd(), "../../packages/scam-engine/src/inngest"),
];

describe("Inngest batchEvents stays within the plan ceiling", () => {
  it("the pre-classifier's batch size is within the ceiling", () => {
    expect(PRECLASSIFY_BATCH_SIZE).toBeLessThanOrEqual(INNGEST_PLAN_MAX_BATCH_SIZE);
  });

  it("the pre-classifier's batch timeout is within the ceiling", () => {
    const m = /^(\d+)s$/.exec(PRECLASSIFY_BATCH_TIMEOUT);
    expect(m, "timeout must be whole seconds, e.g. \"30s\"").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(INNGEST_PLAN_MAX_BATCH_TIMEOUT_S);
  });

  it("no function declares a literal batch timeout above the ceiling", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
        const src = readFileSync(join(dir, f), "utf8");
        for (const m of src.matchAll(/batchEvents:\s*\{[^}]*timeout:\s*"(\d+)([smh])"/g)) {
          const secs = Number(m[1]) * ({ s: 1, m: 60, h: 3600 } as Record<string, number>)[m[2]];
          if (secs > INNGEST_PLAN_MAX_BATCH_TIMEOUT_S) offenders.push(`${f}: ${m[1]}${m[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no function declares a literal maxSize above the ceiling", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
        const src = readFileSync(join(dir, f), "utf8");
        for (const m of src.matchAll(/batchEvents:\s*\{[^}]*maxSize:\s*(\d+)/g)) {
          if (Number(m[1]) > INNGEST_PLAN_MAX_BATCH_SIZE) offenders.push(`${f}: ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
