import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  IS_CLONE_MIN_P,
  RISK_INDICATOR_MIN_P,
  WORKLIST_MIN_CONFIDENCE,
} from "@/lib/clone-watch/preclassify-thresholds";

// ADR-0026: every number a gate compares `confidence` against lives in ONE
// module. Before this, the producer and four consumers held their constants
// in five files with nothing comparing them (memory: mutually unsatisfiable
// constants). This guard fails if a consumer grows a local literal again.

const FN_DIR = join(process.cwd(), "app/api/inngest/functions");
const CONSUMERS = [
  "clone-watch-urlscan-submit.ts",
  "clone-watch-netcraft-auto.ts",
  // clone-watch-auto-triage.ts retired 2026-09-26 (#1230), and with it
  // AUTO_CONFIRM_MIN_CONFIDENCE.
];

describe("preclassify thresholds", () => {
  it("are ordered: is_clone ≤ worklist ≤ 1, indicator cut in (0, 1]", () => {
    expect(IS_CLONE_MIN_P).toBeGreaterThan(0);
    expect(IS_CLONE_MIN_P).toBeLessThanOrEqual(WORKLIST_MIN_CONFIDENCE);
    expect(WORKLIST_MIN_CONFIDENCE).toBeLessThanOrEqual(1);
    expect(RISK_INDICATOR_MIN_P).toBeGreaterThan(0);
    expect(RISK_INDICATOR_MIN_P).toBeLessThanOrEqual(1);
  });

  for (const file of CONSUMERS) {
    it(`${file} imports its threshold and carries no local confidence literal`, () => {
      const src = readFileSync(join(FN_DIR, file), "utf8");
      expect(src).toMatch(/from "@\/lib\/clone-watch\/preclassify-thresholds"/);
      // A literal like `const MIN_CONFIDENCE = 0.7;` is the regression.
      expect(src).not.toMatch(/const (MIN|STRICT)_CONFIDENCE\s*=\s*0?\.\d/);
      expect(src).not.toMatch(/p_min_confidence:\s*0?\.\d/);
      expect(src).not.toMatch(/\.gte\("confidence",\s*0?\.\d/);
    });
  }

  // v315 — the SQL side. A worklist RPC whose p_min_confidence DEFAULT
  // disagrees with the TS gate is a silent starvation trap for any caller that
  // omits the arg. Scan the NEWEST migration that (re)defines each function.
  const MIGRATIONS = join(process.cwd(), "../../supabase");
  const GATED_RPCS = [
    "list_clone_alerts_pending_urlscan_submit",
    "mark_stale_clone_alerts_dormant",
    "list_clone_alerts_pending_netcraft_auto",
  ];
  const version = (f: string) => Number(/^migration-v(\d+)-/.exec(f)?.[1] ?? -1);
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^migration-v\d+-.*\.sql$/.test(f))
    .sort((a, b) => version(b) - version(a));

  for (const fn of GATED_RPCS) {
    it(`${fn}'s newest SQL definition defaults p_min_confidence to WORKLIST_MIN_CONFIDENCE`, () => {
      const re = new RegExp(
        `FUNCTION\\s+public\\.${fn}\\s*\\(([^)]*)\\)`,
        "i",
      );
      let args: string | null = null;
      for (const f of files) {
        const m = re.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
        if (m) {
          args = m[1];
          break;
        }
      }
      expect(args, `no migration defines ${fn}`).not.toBeNull();
      const d = /p_min_confidence\s+real\s+DEFAULT\s+([0-9.]+)/i.exec(args!);
      expect(d, `${fn} has no p_min_confidence default`).not.toBeNull();
      expect(Number(d![1])).toBe(WORKLIST_MIN_CONFIDENCE);
    });
  }
});
