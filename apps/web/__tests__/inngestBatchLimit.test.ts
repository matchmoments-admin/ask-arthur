import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INNGEST_PLAN_MAX_BATCH_SIZE,
  PRECLASSIFY_BATCH_SIZE,
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
