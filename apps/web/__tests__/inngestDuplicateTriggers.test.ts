import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Inngest REJECTS a function that lists the same trigger twice ("duplicate
 * trigger event"), and one rejected function fails the WHOLE app sync
 * (`modified:false`) — no function change registers anywhere, and nothing but
 * the post-deploy `PUT /api/inngest` body says so. #1248 shipped a doubled
 * `{ event: "…manual-trigger.v1" }` on fp-cluster-digest (2026-09-26). Like
 * the plan limits (inngestBatchLimit.test.ts), no typecheck, test or preview
 * exercises the sync, so this scans the sources.
 *
 * Go-red: re-add the second fp-cluster-digest event line → this fails.
 */
const DIRS = [
  join(process.cwd(), "app/api/inngest/functions"),
  join(process.cwd(), "../../packages/scam-engine/src/inngest"),
];

describe("Inngest triggers", () => {
  it("no function lists the same event or cron trigger twice", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
        const src = readFileSync(join(dir, f), "utf8");
        // One segment per createFunction: two functions in one file may
        // legitimately share a schedule (feed-sync.ts).
        const segments = src.split("createFunction(").slice(1);
        segments.forEach((seg, i) => {
          const seen = new Map<string, number>();
          for (const m of seg.matchAll(/\{\s*(event|cron):\s*"([^"]+)"\s*\}/g)) {
            const key = `${m[1]}:${m[2]}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
          for (const [k, n] of seen) if (n > 1) offenders.push(`${f}#${i + 1}: ${k} ×${n}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
