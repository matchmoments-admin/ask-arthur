import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// urlscan UNLISTED budget (PR-B of the clone-watch deepening plan).
//
// The key-wide unlisted quota is 60/min, 100/hour, 1,000/day. This file proves
// that SCHEDULED spend fits (every rolling hour, every minute, every day) from
// the roster in lib/clone-watch/urlscan-budget.ts. It also pins the pure
// runtime decision that MANUAL spend passes through. The lanes' own guards are
// exercised in urlscanBudgetGuards.test.ts.
//
// Go-red record (2026-09-28, each change made → the named test failed →
// reverted):
//   - recheck cron "30 */6 * * *" → "30 */6,9 * * *" in LANE_SHAPES (a 09:30
//     recheck beside the 09:00 submit)
//                  → "no rolling hour's scheduled worst case exceeds 100" FAILED
//   - URLSCAN_SPENDERS.recheck.perRun 90 → 101
//                  → "no rolling hour …" FAILED
//   - enrichment URLSCAN_ENRICHMENT_CRONS "0 3,15,21" → "0 1,15,21" (inside
//     the 00:30 recheck's hour)
//                  → "no rolling hour …" FAILED
//   - URLSCAN_SPENDERS.submit.minStartIntervalMs removed
//                  → "no spender can exceed 60 submits in a minute" FAILED
//                    (75/run unpaced)
//   - URLSCAN_SPENDERS.scanOne.ownCap.perDay 100 → 600
//                  → "the day's scheduled worst case … fits 1,000" FAILED
//   - decideUnlistedSpend: dropped the past-fire reserve (reserve 0 when
//     k <= 0)
//                  → "refuses a manual recheck at 09:05 before the submit row
//                    lands" and "keeps the unlogged rest of a per-submit
//                    lane's run reserved" FAILED
//   - decideUnlistedSpend: `rows === null` treated as []
//                  → "fails closed on an unreadable ledger" FAILED
//   - readUnlistedLedger: returned [] on error
//                  → "returns null, never [], when the read fails" FAILED
//   - submit lane: SUBMIT_BATCH_LIMIT back to a literal 75
//                  → "lanes read their caps from the roster" FAILED

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({} as Record<string, boolean>, {
    get: (t, k: string) => (k in t ? t[k] : true),
    set: (t, k: string, v: boolean) => ((t[k] = v), true),
  }),
}));

import {
  URLSCAN_ENRICHMENT_CRONS,
  URLSCAN_ENRICHMENT_MAX_PER_RUN,
} from "@askarthur/scam-engine/inngest/urlscan-enrichment-schedule";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { cronFiringsOfWeek } from "@/lib/cron-cadence";
import { LANE_SHAPES } from "@/lib/laneHealth";
import { AUDIT_SLOTS_PER_RUN } from "@/lib/clone-watch/not-a-clone-audit";
import {
  SUBMIT_AUDIT_SHARE,
  URLSCAN_SPENDERS,
  URLSCAN_UNLISTED,
  decideUnlistedSpend,
  perMinuteCeiling,
  readUnlistedLedger,
  type LedgerRow,
  type UrlscanSpender,
} from "@/lib/clone-watch/urlscan-budget";

const WEEK = 7 * 24 * 60;
/** A run's spend can land up to this long after its cron fires. Covers the
 *  longest spender finish budget (enrichment 22m; recheck 15m; submit 10m). */
const RUN_SPAN_MIN = 25;

type Roster = Record<string, Pick<UrlscanSpender, "crons" | "perRun">>;

/** Every rolling window of 60 min (+ the run span) over the week whose
 *  scheduled worst case exceeds the hourly quota. */
function hourlyViolations(roster: Roster): string[] {
  const fires = Object.entries(roster).flatMap(([id, s]) =>
    s.crons.length
      ? cronFiringsOfWeek(s.crons).map((m) => ({ id, m, n: s.perRun }))
      : [],
  );
  const out: string[] = [];
  for (let t = 0; t < WEEK; t++) {
    const inWin = fires.filter(
      (f) => (((f.m - t) % WEEK) + WEEK) % WEEK < 60 + RUN_SPAN_MIN,
    );
    const sum = inWin.reduce((a, f) => a + f.n, 0);
    if (sum > URLSCAN_UNLISTED.perHour) {
      out.push(`t=${t}: ${inWin.map((f) => `${f.id}@${f.m}`).join("+")} = ${sum}`);
    }
  }
  return out;
}

describe("urlscan unlisted budget: scheduled spend fits (static)", () => {
  it("no rolling hour's scheduled worst case exceeds 100", () => {
    expect(hourlyViolations(URLSCAN_SPENDERS)).toEqual([]);
  });

  it("every UTC clock hour fits too (the plan's wording)", () => {
    for (let h = 0; h < 24; h++) {
      let sum = 0;
      for (const s of Object.values(URLSCAN_SPENDERS)) {
        if (!s.crons.length) continue;
        const inHour = cronFiringsOfWeek(s.crons).filter(
          (m) => m < 1440 && Math.floor(m / 60) === h,
        ).length;
        sum += inHour * s.perRun;
      }
      expect(sum, `hour ${h}`).toBeLessThanOrEqual(URLSCAN_UNLISTED.perHour);
    }
  });

  it("the checker is not vacuous: moving recheck onto the submit hour fails it", () => {
    const moved: Roster = {
      ...URLSCAN_SPENDERS,
      recheck: { ...URLSCAN_SPENDERS.recheck, crons: ["30 9 * * *"] },
    };
    expect(hourlyViolations(moved).length).toBeGreaterThan(0);
  });

  it("no spender can exceed 60 submits in a minute", () => {
    for (const [id, s] of Object.entries(URLSCAN_SPENDERS)) {
      // +1: the submit lane runs its regular and audit tallies as two paced
      // calls, so one boundary can admit one extra start.
      expect(perMinuteCeiling(s) + 1, id).toBeLessThanOrEqual(
        URLSCAN_UNLISTED.perMinute,
      );
    }
  });

  it("the day's scheduled worst case plus manual own-caps fits 1,000", () => {
    for (let d = 0; d < 7; d++) {
      let sum = 0;
      for (const s of Object.values(URLSCAN_SPENDERS)) {
        const fires = s.crons.length
          ? cronFiringsOfWeek(s.crons).filter((m) => Math.floor(m / 1440) === d)
              .length
          : 0;
        sum += fires * s.perRun + (s.ownCap?.perDay ?? 0);
      }
      expect(sum, `day ${d}`).toBeLessThanOrEqual(URLSCAN_UNLISTED.perDay);
    }
  });

  it("the audit share rides inside the submit cap", () => {
    expect(AUDIT_SLOTS_PER_RUN).toBe(SUBMIT_AUDIT_SHARE);
    expect(SUBMIT_AUDIT_SHARE).toBeLessThan(URLSCAN_SPENDERS.submit.perRun);
  });
});

describe("the roster is the one declaration", () => {
  const web = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  it("schedules come from the lanes' own declarations", () => {
    expect(URLSCAN_SPENDERS.submit.crons).toEqual(
      LANE_SHAPES["shopfront-clone-urlscan-submit"].crons,
    );
    expect(URLSCAN_SPENDERS.recheck.crons).toEqual(
      LANE_SHAPES["shopfront-clone-lifecycle-recheck"].crons,
    );
    expect(URLSCAN_SPENDERS.enrichment.crons).toEqual(URLSCAN_ENRICHMENT_CRONS);
    expect(URLSCAN_SPENDERS.enrichment.perRun).toBe(URLSCAN_ENRICHMENT_MAX_PER_RUN);
  });

  it("lanes read their caps from the roster", () => {
    const submit = web("app/api/inngest/functions/clone-watch-urlscan-submit.ts");
    expect(submit).toMatch(/SUBMIT_BATCH_LIMIT = URLSCAN_SPENDERS\.submit\.perRun/);
    expect(submit).toMatch(/URLSCAN_SPENDERS\.submit\.minStartIntervalMs/);
    const recheck = web("app/api/inngest/functions/clone-watch-lifecycle-recheck.ts");
    expect(recheck).toMatch(/RECHECK_BATCH_LIMIT = URLSCAN_SPENDERS\.recheck\.perRun/);
    expect(recheck).toMatch(/URLSCAN_SPENDERS\.recheck\.minStartIntervalMs/);
    const enrich = readFileSync(
      new URL(
        "../../../packages/scam-engine/src/inngest/urlscan-enrichment.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(enrich).toMatch(/MAX_URLS_PER_RUN = URLSCAN_ENRICHMENT_MAX_PER_RUN/);
    expect(enrich).toMatch(/URLSCAN_ENRICHMENT_CRONS\.map/);
  });

  it("every unlisted submit call site belongs to a roster spender", () => {
    // Code (comments stripped) that calls an unlisted-submit entry point.
    const CALLS =
      /\b(submitURLScanWithDetails|submitURLScan|submitCloneCandidate|submitCandidateBatch)\s*\(/;
    const known: Record<string, string> = {
      "apps/web/lib/clone-watch/urlscan-submit-one.ts": "(the shared helper)",
      "packages/scam-engine/src/urlscan.ts": "(the adapter)",
      "apps/web/app/api/inngest/functions/clone-watch-urlscan-submit.ts": "submit",
      "apps/web/app/api/inngest/functions/clone-watch-lifecycle-recheck.ts": "recheck",
      "apps/web/app/api/inngest/functions/clone-watch-urlscan-scan-one.ts": "scanOne",
      "packages/scam-engine/src/inngest/urlscan-enrichment.ts": "enrichment",
    };
    const repo = new URL("../../../", import.meta.url).pathname;
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(repo, dir))) {
        const rel = join(dir, name);
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        if (statSync(join(repo, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = readFileSync(join(repo, rel), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");
          if (CALLS.test(src)) found.push(rel);
        }
      }
    };
    for (const d of ["apps/web/app", "apps/web/lib", "packages/scam-engine/src"]) walk(d);
    expect(found.sort()).toEqual(Object.keys(known).sort());
    const ids = new Set(Object.values(URLSCAN_SPENDERS).map((s) => s.fnId));
    for (const fn of [
      "shopfront-clone-urlscan-submit",
      "shopfront-clone-lifecycle-recheck",
      "shopfront-clone-urlscan-scan-one",
      "pipeline-urlscan-enrichment",
    ]) {
      expect(ids.has(fn), fn).toBe(true);
    }
  });

  it("every spender with a manual trigger runs the budget guard", () => {
    for (const file of [
      "app/api/inngest/functions/clone-watch-urlscan-submit.ts",
      "app/api/inngest/functions/clone-watch-lifecycle-recheck.ts",
    ]) {
      const src = web(file);
      expect(src, file).toMatch(/manual-trigger/);
      expect(src, file).toMatch(/checkUnlistedHeadroom\(sb, "(submit|recheck)"\)/);
    }
    // scan-one's trigger is the admin route; the route runs the decision.
    expect(web("app/api/admin/clone-watch/scan/route.ts")).toMatch(
      /decideUnlistedSpend\(\s*"scanOne"/,
    );
    // Enrichment has no manual trigger (cron-only), so nothing to guard.
    const enrich = readFileSync(
      new URL(
        "../../../packages/scam-engine/src/inngest/urlscan-enrichment.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(enrich).not.toMatch(/\{\s*event:/);
  });
});

// ── Runtime decision ────────────────────────────────────────────────────────

/** 2026-09-30 is a Wednesday. */
const at = (hhmm: string) => Date.parse(`2026-09-30T${hhmm}:00Z`);
const row = (
  operation: string,
  createdAt: number,
  units: number,
  metadata: Record<string, unknown> = {},
): LedgerRow => ({
  feature: operation === "scan.submit" ? "urlscan-enrichment" : "shopfront_clone_urlscan",
  operation,
  created_at: new Date(createdAt).toISOString(),
  units,
  metadata,
});
const MIN = 60_000;

describe("decideUnlistedSpend (manual-trigger guard)", () => {
  it("allows a manual recheck in a quiet window", () => {
    // 10:30: the 09:00 submit fired 90 min ago, the 12:30 recheck is 2h away.
    const d = decideUnlistedSpend("recheck", 90, [], at("10:30"));
    expect(d).toMatchObject({ ok: true, usedHour: 0, reservedHour: 0 });
  });

  it("refuses a manual recheck at 09:05 before the submit row lands", () => {
    // The submit batch writes its ledger row only at the END of its run
    // (measured 09:05:32 on 2026-09-28). Until then it is in flight: reserved.
    const d = decideUnlistedSpend("recheck", 90, [], at("09:05"));
    expect(d).toMatchObject({ ok: false, reason: "hourly_headroom", reservedHour: 75 });
  });

  it("refuses a manual recheck at 09:05 after the submit row lands", () => {
    const rows = [row("submit_batch", at("09:04"), 60, { audit_offered: 15 })];
    const d = decideUnlistedSpend("recheck", 90, rows, at("09:05"));
    // Observed 60 + 15 audit; the submit fire is now accounted, not reserved.
    expect(d).toMatchObject({ ok: false, reason: "hourly_headroom", usedHour: 75, reservedHour: 0 });
  });

  it("keeps the unlogged rest of a per-submit lane's run reserved", () => {
    // Enrichment writes one row PER submit: 5 logged at 15:05 of a 20-cap run.
    const rows = Array.from({ length: 5 }, (_, i) => row("scan.submit", at("15:01") + i * 1000, 1));
    const d = decideUnlistedSpend("scanOne", 1, rows, at("15:05"));
    expect(d).toMatchObject({ ok: true, usedHour: 5, reservedHour: 15 });
  });

  it("refuses a manual fire 30 min before a scheduled batch", () => {
    const d = decideUnlistedSpend("recheck", 90, [], at("12:00"));
    expect(d).toMatchObject({ ok: false, reason: "hourly_headroom", reservedHour: 90 });
  });

  it("replaces the own-rows cooldown: a second manual recheck in the hour is refused", () => {
    const rows = [row("recheck_submit", at("10:05"), 80, { submit_failed: 2 })];
    const d = decideUnlistedSpend("recheck", 90, rows, at("10:40"));
    expect(d).toMatchObject({ ok: false, reason: "hourly_headroom", usedHour: 82 });
  });

  it("counts every spender, in units, not rows", () => {
    // Three admin scans + one enrichment row: 3 + 1 units, not 4 "runs".
    const rows = [
      row("scan_one", at("10:10"), 1),
      row("scan_one", at("10:11"), 1),
      row("scan_one", at("10:12"), 1),
      row("scan.submit", at("10:13"), 1),
      // retrieve spends a DIFFERENT quota and is ignored.
      row("retrieve_batch", at("10:14"), 40),
    ];
    const d = decideUnlistedSpend("recheck", 90, rows, at("10:30"));
    expect(d).toMatchObject({ ok: true, usedHour: 4 });
    const d2 = decideUnlistedSpend("recheck", 97, rows, at("10:30"));
    expect(d2).toMatchObject({ ok: false, reason: "hourly_headroom" });
  });

  it("fails closed on an unreadable ledger", () => {
    const d = decideUnlistedSpend("recheck", 90, null, at("10:30"));
    expect(d).toMatchObject({ ok: false, reason: "ledger_unreadable", usedHour: null });
  });

  it("refuses when the trailing day is spent", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row("recheck_submit", at("10:30") - (3 + i) * 60 * MIN, 92),
    );
    const d = decideUnlistedSpend("recheck", 90, rows, at("10:30"));
    expect(d).toMatchObject({ ok: false, reason: "daily_headroom", usedDay: 920 });
  });

  it("a disabled scheduled lane reserves nothing", () => {
    const flags = featureFlags as unknown as Record<string, boolean>;
    // 14:30: the 15:00 enrichment is the only fire within the hour.
    expect(decideUnlistedSpend("recheck", 90, [], at("14:30"))).toMatchObject({
      ok: false,
      reservedHour: 20,
    });
    flags.urlScanIO = false;
    try {
      expect(decideUnlistedSpend("recheck", 90, [], at("14:30"))).toMatchObject({
        ok: true,
        reservedHour: 0,
      });
    } finally {
      delete flags.urlScanIO;
    }
  });
});

describe("readUnlistedLedger", () => {
  const sbReturning = (result: unknown) => {
    const chain: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r),
    };
    for (const m of ["select", "in", "gt", "order", "limit"]) chain[m] = () => chain;
    return { from: () => chain } as never;
  };

  it("returns null, never [], when the read fails", async () => {
    expect(await readUnlistedLedger(sbReturning({ data: null, error: { message: "x" } }), at("10:30"))).toBeNull();
    // A PostgREST 204 with no body: data null AND error null.
    expect(await readUnlistedLedger(sbReturning({ data: null, error: null }), at("10:30"))).toBeNull();
  });

  it("returns null when the page is full (rows may be cut off)", async () => {
    const full = Array.from({ length: 1_000 }, () => row("scan_one", at("10:00"), 1));
    expect(await readUnlistedLedger(sbReturning({ data: full, error: null }), at("10:30"))).toBeNull();
  });

  it("returns the rows otherwise", async () => {
    const rows = [row("scan_one", at("10:00"), 1)];
    expect(await readUnlistedLedger(sbReturning({ data: rows, error: null }), at("10:30"))).toEqual(rows);
  });
});
