import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANES } from "@askarthur/scam-engine/lane-outcome";

import {
  NETCRAFT_DAILY_CEILING,
  NETCRAFT_LANES,
  decideNetcraftSpend,
  grantCovers,
  netcraftLaneCap,
  readNetcraftSpentToday,
  utcDayStart,
} from "@/lib/clone-watch/netcraft-budget";
import { postNetcraftIssue } from "@/lib/clone-watch/netcraft-issue-report";

// Netcraft budget (#1301). Three Lanes file with Netcraft as one reporter;
// this file proves (static) that every send goes through the Module, and pins
// the pure decision every Lane runs.
//
// Go-red record (2026-10-13, each change made → the named test failed →
// reverted):
//   - the whole file against origin/main (no Module, POSTs take no grant)
//        → every test FAILED (import of netcraft-budget unresolved)
//   - dropped `claimNetcraftBudget` from the issue Lane (grant still passed
//     from a hand-built literal)
//        → "every file that sends to Netcraft claims a budget grant" FAILED
//        → "only the Module builds a grant" FAILED
//   - decideNetcraftSpend: `spent === null` treated as all-zero
//        → "fails closed on an unreadable ledger" FAILED
//   - decideNetcraftSpend: ignored the other Lanes' spend (spentTotal = spentLane)
//        → "the ceiling counts every Lane on the account" FAILED
//   - readNetcraftSpentToday: returned zeros on error
//        → "returns null, never zeros, when the read fails" FAILED
//   - readNetcraftSpentToday: counted dry-run rows
//        → "counts what was filed: …dry-run rows are not spend" FAILED
//   - postNetcraftIssue: dropped the grantCovers check
//        → "postNetcraftIssue sends nothing without an issue grant" FAILED
//   - NETCRAFT_LANES.auto.defaultCap 50 → 60
//        → "no Lane's cap exceeds the account ceiling" FAILED
//        → "the auto cap matches the worklist RPC's hard LIMIT" FAILED

const repo = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(repo, dir))) {
      const rel = join(dir, name);
      if (
        name === "node_modules" ||
        name === "__tests__" ||
        name.startsWith(".")
      )
        continue;
      if (statSync(join(repo, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push({ rel, src: stripComments(read(rel)) });
      }
    }
  };
  for (const d of [
    "apps/web/app",
    "apps/web/lib",
    "apps/web/scripts",
    "packages",
  ])
    walk(d);
  return out;
}

const ADAPTERS = [
  "apps/web/lib/clone-watch/netcraft-report.ts", // bulk report POST
  "apps/web/lib/clone-watch/netcraft-issue-report.ts", // report_issue POST
  "apps/web/lib/clone-watch/netcraft-urls.ts", // GET-only reader
];

describe("every Netcraft send goes through the budget (static)", () => {
  const all = sources();

  it("every file that sends to Netcraft claims a budget grant", () => {
    const senders = all
      .filter(
        ({ rel, src }) =>
          !ADAPTERS.includes(rel) && /\bpostNetcraft(Bulk|Issue)\(/.test(src),
      )
      .map(({ rel, src }) => ({
        rel,
        claims: /\bclaimNetcraftBudget\(/.test(src),
      }));
    expect(senders.map((s) => s.rel).sort()).toEqual([
      "apps/web/app/api/inngest/functions/clone-watch-netcraft-auto.ts",
      "apps/web/app/api/inngest/functions/clone-watch-netcraft-issue.ts",
    ]);
    for (const s of senders) expect(s.claims, s.rel).toBe(true);
    // Both auto-fn Lanes claim under their own name.
    const auto = read(
      "apps/web/app/api/inngest/functions/clone-watch-netcraft-auto.ts",
    );
    expect(auto).toMatch(/claimNetcraftBudget\(sb, "auto"/);
    expect(auto).toMatch(/claimNetcraftBudget\(sb, "resubmit"/);
    expect(
      read("apps/web/app/api/inngest/functions/clone-watch-netcraft-issue.ts"),
    ).toMatch(/claimNetcraftBudget\(sb, "issue"/);
  });

  it("only the Adapters name Netcraft's API, and the reader never POSTs", () => {
    const naming = all
      .filter(({ src }) =>
        /report\.netcraft\.com\/api|NETCRAFT_API_BASE|NETCRAFT_(REPORT|TEST)_ENDPOINT/.test(
          src,
        ),
      )
      .map(({ rel }) => rel);
    for (const rel of naming) expect(ADAPTERS, rel).toContain(rel);
    expect(
      stripComments(read("apps/web/lib/clone-watch/netcraft-urls.ts")),
    ).not.toMatch(/method:\s*"POST"/);
  });

  it("only the Module builds a grant", () => {
    const forging = all
      .filter(({ src }) => src.includes('"netcraft-budget-grant"'))
      .map(({ rel }) => rel);
    expect(forging).toEqual(["apps/web/lib/clone-watch/netcraft-budget.ts"]);
  });

  it("the Lanes read their caps from the roster, not their own env reads", () => {
    const auto = stripComments(
      read("apps/web/app/api/inngest/functions/clone-watch-netcraft-auto.ts"),
    );
    const issue = stripComments(
      read("apps/web/app/api/inngest/functions/clone-watch-netcraft-issue.ts"),
    );
    expect(auto).toMatch(/netcraftLaneCap\("auto"\)/);
    expect(auto).toMatch(/netcraftLaneCap\("resubmit"\)/);
    expect(issue).toMatch(/netcraftLaneCap\("issue"\)/);
    for (const src of [auto, issue]) {
      expect(src).not.toMatch(/NETCRAFT_(RESUBMIT|ISSUE)_DAILY_CAP/);
    }
    // The old own-Lane counter whose failed read counted as 0 used.
    expect(issue).not.toMatch(/count_todays_netcraft_issues/);
  });
});

describe("the roster", () => {
  it("covers every Netcraft Lane that files; reconcile only reads", () => {
    const filing = Object.entries(LANES)
      .filter(([, row]) => row.provider === "netcraft")
      .map(([id]) => id)
      .filter((id) => id !== "shopfront-clone-netcraft-reconcile"); // GET /submission only
    expect(
      Object.values(NETCRAFT_LANES)
        .map((l) => l.lane)
        .sort(),
    ).toEqual(filing.sort());
  });

  it("no Lane's cap exceeds the account ceiling", () => {
    for (const [id, l] of Object.entries(NETCRAFT_LANES)) {
      expect(l.defaultCap, id).toBeLessThanOrEqual(NETCRAFT_DAILY_CEILING);
    }
  });

  it("the auto cap matches the worklist RPC's hard LIMIT", () => {
    const dir = join(repo, "supabase");
    const newest = readdirSync(dir)
      .filter((f) => /^migration-v\d+.*\.sql$/.test(f))
      .filter((f) =>
        /FUNCTION public\.list_clone_alerts_pending_netcraft_auto\(/.test(
          readFileSync(join(dir, f), "utf8"),
        ),
      )
      .sort(
        (a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1]),
      )
      .pop()!;
    const body = readFileSync(join(dir, newest), "utf8");
    const hard = body.match(/LIMIT LEAST\([\s\S]*?,\s*(\d+)\s*\)/);
    expect(Number(hard?.[1])).toBe(NETCRAFT_LANES.auto.defaultCap);
  });

  it("caps honour a positive env override and ignore garbage", () => {
    vi.stubEnv("NETCRAFT_ISSUE_DAILY_CAP", " 7 ");
    vi.stubEnv("NETCRAFT_RESUBMIT_DAILY_CAP", "abc");
    expect(netcraftLaneCap("issue")).toBe(7);
    expect(netcraftLaneCap("resubmit")).toBe(15);
    expect(netcraftLaneCap("auto")).toBe(50);
    vi.unstubAllEnvs();
  });
});

describe("decideNetcraftSpend", () => {
  const NOW = Date.parse("2026-10-13T13:00:00Z");
  const zero = { auto: 0, resubmit: 0, issue: 0 };

  it("fails closed on an unreadable ledger", () => {
    expect(decideNetcraftSpend("auto", 3, null, NOW)).toMatchObject({
      ok: false,
      reason: "ledger_unreadable",
    });
  });

  it("grants the request when there is room", () => {
    const d = decideNetcraftSpend("auto", 3, zero, NOW, 50);
    expect(d).toMatchObject({
      ok: true,
      grant: { lane: "auto", allowed: 3, day: "2026-10-13", spentTotal: 0 },
    });
  });

  it("clips to the Lane's own cap", () => {
    expect(
      decideNetcraftSpend("issue", 20, { ...zero, issue: 18 }, NOW, 20),
    ).toMatchObject({
      ok: true,
      grant: { allowed: 2 },
    });
    expect(
      decideNetcraftSpend("issue", 1, { ...zero, issue: 20 }, NOW, 20),
    ).toMatchObject({
      ok: false,
      reason: "lane_cap_reached",
    });
  });

  it("the ceiling counts every Lane on the account", () => {
    // auto 40 + issue 8 = 48 filed: resubmit may file 2, though its own cap is 15.
    const spent = { auto: 40, resubmit: 0, issue: 8 };
    expect(decideNetcraftSpend("resubmit", 15, spent, NOW, 15)).toMatchObject({
      ok: true,
      grant: { allowed: 2, spentTotal: 48 },
    });
    expect(
      decideNetcraftSpend("resubmit", 1, { ...spent, issue: 10 }, NOW, 15),
    ).toMatchObject({
      ok: false,
      reason: "daily_ceiling_reached",
    });
  });

  it("refuses an empty request", () => {
    expect(decideNetcraftSpend("auto", 0, zero, NOW)).toMatchObject({
      ok: false,
      reason: "nothing_requested",
    });
  });

  it("one clock: the UTC calendar day", () => {
    expect(
      new Date(utcDayStart(Date.parse("2026-10-13T23:59:59Z"))).toISOString(),
    ).toBe("2026-10-13T00:00:00.000Z");
    expect(
      new Date(utcDayStart(Date.parse("2026-10-14T00:00:00Z"))).toISOString(),
    ).toBe("2026-10-14T00:00:00.000Z");
  });
});

describe("grantCovers", () => {
  const d = decideNetcraftSpend(
    "resubmit",
    4,
    { auto: 0, resubmit: 0, issue: 0 },
    Date.now(),
    15,
  );
  const grant = d.ok ? d.grant : null;
  it("covers its own Lane up to `allowed`, nothing else", () => {
    expect(grantCovers(grant, "resubmit", 4)).toBe(true);
    expect(grantCovers(grant, "resubmit", 5)).toBe(false);
    expect(grantCovers(grant, "auto", 1)).toBe(false);
    expect(grantCovers(grant, "resubmit", 0)).toBe(false);
    expect(grantCovers(null, "resubmit", 1)).toBe(false);
  });
});

describe("readNetcraftSpentToday", () => {
  const NOW = Date.parse("2026-10-13T13:00:00Z");
  function fakeSb(result: { data: unknown; error: unknown } | Error) {
    const calls: Record<string, unknown[]> = {};
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "limit"]) {
      q[m] = (...args: unknown[]) => {
        calls[m] = args;
        if (m === "limit")
          return result instanceof Error
            ? Promise.reject(result)
            : Promise.resolve(result);
        return q;
      };
    }
    return { sb: { from: () => q } as never, calls };
  }
  const row = (
    feature: string,
    operation: string,
    units: number,
    metadata: Record<string, unknown> = {},
  ) => ({
    feature,
    operation,
    units: String(units),
    metadata,
  });

  it("counts what was filed: each Lane's Outcome Row units; dry-run rows are not spend", async () => {
    const { sb, calls } = fakeSb({
      data: [
        row("shopfront_clone_netcraft_auto", "bulk_submit", 2),
        row("shopfront_clone_netcraft_auto", "bulk_submit", 1),
        row("shopfront_clone_netcraft_resubmit", "resubmit_bulk", 3),
        row("shopfront_clone_netcraft_issue", "issue_report", 4),
        row("shopfront_clone_netcraft_issue", "issue_report", 9, {
          dryRun: true,
        }),
        row("shopfront_clone_netcraft_issue", "other_op", 5),
      ],
      error: null,
    });
    expect(await readNetcraftSpentToday(sb, NOW)).toEqual({
      auto: 3,
      resubmit: 3,
      issue: 4,
    });
    expect(calls.gte).toEqual(["created_at", "2026-10-13T00:00:00.000Z"]);
  });

  it("returns null, never zeros, when the read fails", async () => {
    expect(
      await readNetcraftSpentToday(
        fakeSb({ data: null, error: { message: "x" } }).sb,
        NOW,
      ),
    ).toBeNull();
    expect(
      await readNetcraftSpentToday(fakeSb(new Error("net")).sb, NOW),
    ).toBeNull();
  });

  it("returns null when a full page means rows may be cut off", async () => {
    const data = Array.from({ length: 500 }, () =>
      row("shopfront_clone_netcraft_auto", "bulk_submit", 0),
    );
    expect(
      await readNetcraftSpentToday(fakeSb({ data, error: null }).sb, NOW),
    ).toBeNull();
  });
});

describe("postNetcraftIssue", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("postNetcraftIssue sends nothing without an issue grant", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const payload = { reason: "r", urls: [] } as never;
    const auto = decideNetcraftSpend(
      "auto",
      1,
      { auto: 0, resubmit: 0, issue: 0 },
      Date.now(),
    );
    for (const g of [null, auto.ok ? auto.grant : null]) {
      const r = await postNetcraftIssue("uuid-1", payload, g);
      expect(r).toMatchObject({ ok: false, status: 0 });
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
