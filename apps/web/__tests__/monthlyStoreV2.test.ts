import { describe, expect, it } from "vitest";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import { stockStatus, type StockDns } from "@/lib/clone-watch/clone-metrics";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import { buildTrendRows, type CardInputs } from "@/lib/clone-watch/report-card";
import {
  classifierVersionByBrand,
  loadStoreV2Inputs,
  readMonthlyBrandStore,
  sumDomainsScanned,
  takedownEventsFromRows,
  type StockSnapshotRow,
} from "@/lib/clone-watch/monthly-brand-store";
import {
  domainCoveredForMonth,
  domainsWatchedInMonth,
  type BrandCoverage,
} from "@/lib/clone-watch/brand-coverage";
import {
  isDeadDormant,
  probeChunk,
  selectActiveStock,
  type StockRow,
} from "@/lib/clone-watch/month-end-stock";

/**
 * Monthly store v2 (v325, #1225) — the TS half.
 *
 * Go-red record (each verified by reinstating the named bug):
 *   - NULL-not-0: make foldStockSnapshot return an empty fold for `[]` /
 *     null → active_stock_eom reads 0 for a month that was never probed.
 *   - zero rows: delete the `brandRows.push(...zeroRows)` line → the watched
 *     brand with nothing found has no row.
 *   - status precedence: move the `weaponised` check below parking → the
 *     dns-parking.com phish reads parked; apply the stored hold before the
 *     host check → the resolving name with a stale hold reads held.
 *   - unverified share: drop the `st.measured` check in report-card v2() →
 *     kmart's 2-of-3-unverified snapshot persists active_stock_eom 1.
 *   - trust gate: drop the `rows.length !== written` check in
 *     loadStoreV2Inputs → the 120-of-300 partial snapshot is folded.
 *   - pagination: restore the single `.range(0, 999)` read → 1,000 of 1,250.
 *   - budget prefix: let probeChunk count every settled result as handled →
 *     the unprobed tail is dropped instead of carried.
 */

const AUG = "2026-08";

function row(brand: string, domain: string, over: Partial<CloneAlertRow> = {}): CloneAlertRow {
  return {
    id: 1,
    candidate_domain: domain,
    inferred_target_domain: brand,
    target_brand_normalized: null,
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    campaign_key: null,
    submitted_to: null,
    lifecycle_state: null,
    netcraft_declined_at: null,
    weaponised_at: null,
    first_seen_at: "2026-08-10T00:00:00Z",
    triage_status: null,
    ...over,
  } as CloneAlertRow;
}

function inputs(over: Partial<CardInputs> = {}): CardInputs {
  const window = monthWindow(AUG);
  return {
    window,
    priorWindow: priorWindow(window.startIso),
    rows: [],
    priorRows: [],
    coverage: [],
    priorSpotlightBrand: null,
    watchlistFallbackSize: 293,
    ...over,
  };
}

const cov = (brandDomain: string, coveredFrom = "2026-05-26", coveredTo: string | null = null): BrandCoverage => ({
  brandDomain,
  brandNormalized: brandDomain.split(".")[0],
  coveredFrom,
  coveredTo,
});

const snap = (brand: string, status: StockSnapshotRow["status"], at = "2026-09-01T01:05:00Z"): StockSnapshotRow => ({
  brand,
  status,
  checked_at: at,
});

// ── DNS fixtures ─────────────────────────────────────────────────────────────
const recs = (...r: string[]) => ({ records: r });
const err = (errorCode: string) => ({ errorCode });
const dns = (over: Partial<StockDns> = {}): StockDns => ({
  a: recs("1.2.3.4"),
  aaaa: null,
  ns: recs("ns1.cloudflare.com"),
  ...over,
});

describe("stockStatus — fresh DNS first, stored facts only where DNS did not prove absence", () => {
  const HOLD = { whois: { statuses: ["clientHold"] } };
  const cases: Array<[string, Parameters<typeof stockStatus>[0], string]> = [
    ["no probe at all", { dns: null }, "unverified"],
    ["NXDOMAIN on A and NS", { dns: dns({ a: err("ENOTFOUND"), ns: err("ENOTFOUND") }) }, "gone"],
    [
      "gone beats a stale registry hold",
      { dns: dns({ a: err("ENOTFOUND"), ns: err("ENOTFOUND") }), attribution: HOLD },
      "gone",
    ],
    [
      "a stale hold on a name that resolves reads what DNS says",
      { dns: dns(), attribution: HOLD },
      "live",
    ],
    [
      "held explains a registered name with no address",
      { dns: dns({ a: err("ENODATA"), aaaa: err("ENODATA") }), attribution: HOLD },
      "held",
    ],
    [
      "held when the resolver proved nothing",
      { dns: dns({ a: err("ESERVFAIL"), aaaa: err("ESERVFAIL"), ns: err("ESERVFAIL") }), attribution: HOLD },
      "held",
    ],
    [
      "for-sale page never outlives the address (no_host)",
      { dns: dns({ a: err("ENODATA"), aaaa: err("ENODATA") }), urlscan_classification: "parked_for_sale" },
      "no_host",
    ],
    [
      "fresh parking NS with no address is parked",
      { dns: dns({ a: err("ENODATA"), aaaa: err("ENODATA"), ns: recs("ns1.sedoparking.com") }) },
      "parked",
    ],
    ["fresh parking NS", { dns: dns({ ns: recs("NS1.SEDOPARKING.COM.") }) }, "parked"],
    [
      "fresh NS off parking overrides a stored parking NS",
      { dns: dns({ ns: recs("ns1.cloudflare.com") }), attribution: { whois: { nameServers: ["ns1.afternic.com"] } } },
      "live",
    ],
    [
      "stored parking NS when the fresh NS lookup failed",
      { dns: dns({ ns: err("ETIMEOUT") }), attribution: { whois: { nameServers: ["ns1.afternic.com"] } } },
      "parked",
    ],
    ["urlscan for-sale page", { dns: dns(), urlscan_classification: "parked_for_sale" }, "parked"],
    ["weaponised beats a shared-host parking NS", { dns: dns({ ns: recs("ns1.dns-parking.com") }), lifecycle_state: "weaponised" }, "live_phishing"],
    ["weaponised and resolving", { dns: dns(), lifecycle_state: "weaponised" }, "live_phishing"],
    ["resolves (A)", { dns: dns() }, "live"],
    ["resolves (AAAA only)", { dns: dns({ a: err("ENODATA"), aaaa: recs("::1") }) }, "live"],
    ["registered, no address", { dns: dns({ a: err("ENODATA"), aaaa: err("ENODATA") }) }, "no_host"],
    ["SERVFAIL proves nothing", { dns: dns({ a: err("ESERVFAIL"), aaaa: err("ESERVFAIL"), ns: err("ESERVFAIL") }) }, "unverified"],
  ];
  for (const [name, input, want] of cases) {
    it(name, () => expect(stockStatus(input)).toBe(want));
  }
});

describe("buildTrendRows — v325 stock columns", () => {
  it("is NULL — not 0 — when there is no month-end snapshot (absent, null or empty)", () => {
    for (const stockSnapshots of [undefined, null, [] as StockSnapshotRow[]]) {
      const t = buildTrendRows(inputs({ rows: [row("kmart.com.au", "kmart-a.com")], stockSnapshots }));
      const r = t.brandRows.find((b) => b.brand === "kmart.com.au")!;
      expect(r.active_stock_eom).toBeNull();
      expect(r.stock_by_status).toBeNull();
      expect(r.liveness_checked_at).toBeNull();
    }
  });

  it("counts live_phishing + live + parked across ALL months, and 0 for a brand with no stock in a snapshot that ran", () => {
    const t = buildTrendRows(
      inputs({
        rows: [row("kmart.com.au", "kmart-a.com"), row("mecca.com.au", "mecca-a.com")],
        stockSnapshots: [
          snap("kmart.com.au", "live_phishing"),
          snap("kmart.com.au", "live"),
          snap("KMART.com.au", "parked", "2026-09-01T01:09:00Z"),
          snap("kmart.com.au", "gone"),
          snap("kmart.com.au", "held"),
          snap("kmart.com.au", "unverified"),
          snap("other.com", "live"),
        ],
      }),
    );
    const k = t.brandRows.find((b) => b.brand === "kmart.com.au")!;
    expect(k.active_stock_eom).toBe(3);
    expect(k.stock_by_status).toMatchObject({ live_phishing: 1, live: 1, parked: 1, gone: 1, held: 1, unverified: 1, no_host: 0 });
    expect(k.liveness_checked_at).toBe("2026-09-01T01:09:00Z");
    const m = t.brandRows.find((b) => b.brand === "mecca.com.au")!;
    expect(m.active_stock_eom).toBe(0);
  });

  it("persists NULL for a brand whose snapshot is mostly unverified (a bad resolver night is not '0 up')", () => {
    const t = buildTrendRows(
      inputs({
        rows: [row("kmart.com.au", "kmart-a.com"), row("mecca.com.au", "mecca-a.com")],
        stockSnapshots: [
          snap("kmart.com.au", "unverified"),
          snap("kmart.com.au", "unverified"),
          snap("kmart.com.au", "live"),
          ...Array.from({ length: 9 }, () => snap("mecca.com.au", "gone")),
          snap("mecca.com.au", "unverified"), // 1 of 10 — within the 20% allowance
        ],
      }),
    );
    const k = t.brandRows.find((b) => b.brand === "kmart.com.au")!;
    expect(k.active_stock_eom).toBeNull();
    expect(k.stock_by_status).toMatchObject({ unverified: 2, live: 1 }); // the counts still stand
    expect(t.brandRows.find((b) => b.brand === "mecca.com.au")!.active_stock_eom).toBe(0);
  });

  it("writes a zero row for every brand watched in the month, and for stock-only brands", () => {
    const t = buildTrendRows(
      inputs({
        rows: [row("kmart.com.au", "kmart-a.com")],
        coverage: [
          cov("kmart.com.au"),
          cov("westpac.com.au"), // watched, nothing found
          cov("domain.com.au"), // denylisted generic brand — never counted, never zeroed
          cov("later.com.au", "2026-09-01"), // added after the month
          cov("gone-before.com.au", "2026-05-26", "2026-08-01"), // gone by 1 Aug
          cov("left-mid.com.au", "2026-05-26", "2026-09-01"), // watched for part of it
        ],
        stockSnapshots: [snap("stockonly.com.au", "parked"), snap("kmart.com.au", "live")],
        takedownEvents: takedownEventsFromRows([
          row("westpac.com.au", "westpac-old.com", {
            submitted_to: { netcraft: { takedown_at: "2026-08-20T00:00:00Z" } },
          }),
        ]),
      }),
    );
    const brands = t.brandRows.map((b) => b.brand);
    expect(brands[0]).toBe("kmart.com.au"); // targeted rows first
    expect(brands).toContain("westpac.com.au");
    expect(brands).toContain("left-mid.com.au");
    expect(brands).toContain("stockonly.com.au");
    expect(brands).not.toContain("domain.com.au");
    expect(brands).not.toContain("later.com.au");
    expect(brands).not.toContain("gone-before.com.au");

    const w = t.brandRows.find((b) => b.brand === "westpac.com.au")!;
    expect(w).toMatchObject({
      clones: 0,
      new_registered: 0,
      alert_ids: [],
      brand_normalized: "westpac",
      is_au: true,
      active_stock_eom: 0,
      coverage_full_month: true,
      matcher_version: "v4",
      // a squat from an EARLIER month taken down in August
      taken_down_in_month: 1,
    });
    expect(t.brandRows.find((b) => b.brand === "left-mid.com.au")!.coverage_full_month).toBe(false);
    expect(t.brandRows.find((b) => b.brand === "stockonly.com.au")!.active_stock_eom).toBe(1);
  });

  it("stamps provenance: matcher version, dominant classifier, feed denominator", () => {
    const t = buildTrendRows(
      inputs({
        rows: [
          row("kmart.com.au", "a.com", { clone_watch_classifications: { is_clone: true, confidence: 0.9, attack_intent: null, model_id: "jev-1.13.0" } }),
          row("kmart.com.au", "b.com", { clone_watch_classifications: { is_clone: true, confidence: 0.9, attack_intent: null, model_id: "jev-1.13.0" } }),
          row("kmart.com.au", "c.com", { clone_watch_classifications: { is_clone: true, confidence: 0.9, attack_intent: null, model_id: "claude-haiku-4-5" } }),
        ],
        sweptDomains: 2_100_000,
        coverage: null,
      }),
    );
    const k = t.brandRows[0];
    expect(k.new_registered).toBe(3);
    expect(k.matcher_version).toBe("v4");
    expect(k.classifier_version).toBe("jev-1.13.0+claude-haiku-4-5"); // a swap month shows both
    expect(k.swept_domains).toBe(2_100_000);
    expect(k.coverage_full_month).toBeNull(); // coverage unreadable ≠ not covered
  });
});

describe("coverage helpers", () => {
  it("domainCoveredForMonth: a composition change on a shared domain is not a whole month", () => {
    const rows = [cov("servicesaustralia.gov.au", "2026-05-26"), { ...cov("servicesaustralia.gov.au", "2026-06-16"), brandNormalized: "medicare" }];
    expect(domainCoveredForMonth(rows, "servicesaustralia.gov.au", "2026-06-01")).toBe(false);
    expect(domainCoveredForMonth(rows, "servicesaustralia.gov.au", "2026-07-01")).toBe(true);
    expect(domainCoveredForMonth(rows, "nomatch.com.au", "2026-07-01")).toBe(false);
  });

  it("domainsWatchedInMonth: any overlap, lower-cased", () => {
    const got = domainsWatchedInMonth([cov("A.com"), cov("b.com", "2026-08-31"), cov("c.com", "2026-09-01")], "2026-08-01");
    expect([...got].sort()).toEqual(["a.com", "b.com"]);
  });
});

describe("small folds", () => {
  it("sumDomainsScanned: null when telemetry starts after the month's first days (June's shape)", () => {
    const rows = [{ metadata: { domains_scanned: 70000 }, created_at: "2026-06-27T08:30:00Z" }];
    expect(sumDomainsScanned(rows, "2026-06-01T00:00:00Z")).toBeNull();
    expect(sumDomainsScanned([{ ...rows[0], created_at: "2026-06-02T08:30:00Z" }], "2026-06-01T00:00:00Z")).toBe(70000);
  });

  it("sumDomainsScanned: null when no ingest row carried the key", () => {
    expect(sumDomainsScanned([])).toBeNull();
    expect(sumDomainsScanned([{ metadata: { reason: "no_file" } }])).toBeNull();
    expect(sumDomainsScanned([{ metadata: { domains_scanned: 70000 } }, { metadata: { domains_scanned: 5 } }, { metadata: null }])).toBe(70005);
  });

  it("classifierVersionByBrand dedupes per candidate, most frequent first, ties alphabetical", () => {
    const c = (m: string) => ({ is_clone: true, confidence: 1, attack_intent: null, model_id: m });
    const got = classifierVersionByBrand([
      row("x.com", "a.com", { clone_watch_classifications: c("zeta") }),
      row("x.com", "a.com", { clone_watch_classifications: c("zeta") }), // duplicate candidate
      row("x.com", "b.com", { clone_watch_classifications: c("alpha") }),
    ]);
    expect(got.get("x.com")).toBe("alpha+zeta");
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────
function pagedClient(total: number) {
  const calls: Array<{ from: number; to: number; gt?: [string, number] }> = [];
  const all = Array.from({ length: total }, (_, i) => ({ brand: `b${String(i).padStart(5, "0")}.com`, clones: 1 }));
  const client = {
    from: () => {
      const q: Record<string, unknown> & { _gt?: [string, number] } = {};
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: (c: string, v: number) => ((q._gt = [c, v]), chain),
        order: () => chain,
        range: async (from: number, to: number) => {
          calls.push({ from, to, gt: q._gt });
          return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

describe("readMonthlyBrandStore", () => {
  it("reads every page past PostgREST's 1,000-row cap, targeted brands only", async () => {
    const { client, calls } = pagedClient(1_250);
    const rows = await readMonthlyBrandStore(client as never, "2026-09-01");
    expect(rows).toHaveLength(1_250);
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.gt?.[0] === "clones" && c.gt?.[1] === 0)).toBe(true);
  });
});

// ── Month-end stock selection + probe chunk ─────────────────────────────────
describe("selectActiveStock", () => {
  it("drops terminal / fp / denylisted rows and counts a domain once (lowest id)", () => {
    const ids = selectActiveStock([
      { id: 5, candidate_domain: "dup.com", inferred_target_domain: "a.com", lifecycle_state: "declined", triage_status: null },
      { id: 2, candidate_domain: "DUP.com", inferred_target_domain: "a.com", lifecycle_state: "monitoring", triage_status: null },
      { id: 3, candidate_domain: "down.com", inferred_target_domain: "a.com", lifecycle_state: "taken_down", triage_status: null },
      { id: 4, candidate_domain: "old.com", inferred_target_domain: "a.com", lifecycle_state: "dormant", triage_status: null },
      { id: 6, candidate_domain: "fp.com", inferred_target_domain: "a.com", lifecycle_state: null, triage_status: "fp" },
      { id: 7, candidate_domain: "gen.com", inferred_target_domain: "domain.com.au", lifecycle_state: null, triage_status: null },
      { id: 8, candidate_domain: "w.com", inferred_target_domain: "a.com", lifecycle_state: "weaponised", triage_status: "tp_actioned" },
      { id: 9, candidate_domain: null, inferred_target_domain: "a.com", lifecycle_state: null, triage_status: null },
    ]);
    expect(ids).toEqual([2, 8]);
  });
});

const stockRow = (id: number, over: Partial<StockRow> = {}): StockRow => ({
  id,
  candidate_domain: `d${id}.com`,
  inferred_target_domain: "Kmart.com.au",
  attribution: null,
  urlscan_classification: null,
  lifecycle_state: "declined",
  urlscan_uuid: "u",
  urlscan_failure_streak: 0,
  urlscan_evidence: null,
  ...over,
});

describe("probeChunk", () => {
  it("probes every id, skips a vanished row, and flags dead-dormant rows that now resolve", async () => {
    const res = await probeChunk({
      ids: [1, 2, 3, 4],
      rows: [
        stockRow(1),
        stockRow(2, { urlscan_uuid: null, urlscan_failure_streak: 8, urlscan_evidence: { status: "400" } }),
        stockRow(4, { urlscan_uuid: null, urlscan_failure_streak: 9, urlscan_evidence: { status: 400 } }),
      ],
      periodMonth: "2026-09-01",
      probe: async (h) => (h === "d4.com" ? dns({ a: err("ENODATA"), aaaa: err("ENODATA") }) : dns()),
      expired: () => false,
    });
    expect(res.handled).toBe(4);
    expect(res.snapshots.map((s) => [s.alert_id, s.status, s.brand])).toEqual([
      [1, "live", "kmart.com.au"],
      [2, "live", "kmart.com.au"],
      [4, "no_host", "kmart.com.au"],
    ]);
    // 2 resolves → reset; 4 is dormant but has no address → stays dormant
    expect(res.dormantResolving).toEqual([2]);
  });

  it("stops at the budget and reports a PREFIX, so the tail carries to the next chunk", async () => {
    let probes = 0;
    const res = await probeChunk({
      ids: [1, 2, 3, 4, 5],
      rows: [1, 2, 3, 4, 5].map((i) => stockRow(i)),
      periodMonth: "2026-09-01",
      probe: async () => {
        probes++;
        return dns();
      },
      expired: () => probes >= 2,
      concurrency: 1,
    });
    expect(res.handled).toBe(2);
    expect(res.snapshots.map((s) => s.alert_id)).toEqual([1, 2]);
  });

  it("a throwing probe is unverified, never gone", async () => {
    const res = await probeChunk({
      ids: [1],
      rows: [stockRow(1)],
      periodMonth: "2026-09-01",
      probe: async () => {
        throw new Error("resolver down");
      },
      expired: () => false,
    });
    expect(res.snapshots[0].status).toBe("unverified");
  });

  it("isDeadDormant mirrors the v326 predicate", () => {
    expect(isDeadDormant({ urlscan_uuid: null, urlscan_failure_streak: 8, urlscan_evidence: { status: "400" } })).toBe(true);
    expect(isDeadDormant({ urlscan_uuid: null, urlscan_failure_streak: 7, urlscan_evidence: { status: "400" } })).toBe(false);
    expect(isDeadDormant({ urlscan_uuid: "x", urlscan_failure_streak: 8, urlscan_evidence: { status: "400" } })).toBe(false);
    expect(isDeadDormant({ urlscan_uuid: null, urlscan_failure_streak: 8, urlscan_evidence: null })).toBe(false);
  });
});

// ── The snapshot trust gate (review of #1225, defect 1) ─────────────────────
function v2Client(opts: { run: { written: number } | null; snapshots: number }) {
  const snaps = Array.from({ length: opts.snapshots }, (_, i) => ({
    brand: "kmart.com.au",
    status: "live",
    checked_at: `2026-10-01T01:0${i % 10}:00Z`,
  }));
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: table === "clone_liveness_runs" ? opts.run : null, error: null }),
        range: async (from: number, to: number) => ({ data: snaps.slice(from, to + 1), error: null }),
      };
      return chain;
    },
  };
}

describe("loadStoreV2Inputs — trusts a snapshot only when its run completed", () => {
  const w = { periodMonth: "2026-09-01", startIso: "2026-09-01T00:00:00Z", endIso: "2026-10-01T00:00:00Z" };

  it("no completion record → not measured (a run that died mid-walk)", async () => {
    const got = await loadStoreV2Inputs(v2Client({ run: null, snapshots: 120 }) as never, w);
    expect(got).toMatchObject({ stockState: "no_run", stockSnapshots: null });
  });

  it("row count differs from the record → not measured", async () => {
    const got = await loadStoreV2Inputs(v2Client({ run: { written: 300 }, snapshots: 120 }) as never, w);
    expect(got).toMatchObject({ stockState: "partial", stockSnapshots: null });
  });

  it("record matches → the snapshot is folded", async () => {
    const got = await loadStoreV2Inputs(v2Client({ run: { written: 120 }, snapshots: 120 }) as never, w);
    expect(got.stockState).toBe("measured");
    expect(got.stockSnapshots).toHaveLength(120);
  });
});
