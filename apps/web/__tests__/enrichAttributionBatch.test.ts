import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1229 part 1 — the attribution enricher's 60 per-alert `enrich-${id}` steps
 * folded into ONE bounded-concurrency step with a chunked bulk write.
 *
 * What the per-row steps were buying was checkpointing: a retry never re-paid
 * a completed row's lookups. These tests pin the two mechanisms that replace
 * it (read-back + chunked flush), the pacing that keeps whoisjson under its
 * 20/min cap, and — at the function level — that the fan-out is really gone.
 *
 * Go-red record (2026-09-26, each reverted → failed → restored):
 *   - read-back removed (`todo = rows`): "skips rows a previous attempt
 *     already wrote" and "a retry after a partial attempt looks every row up
 *     exactly once" fail.
 *   - flush only at the end (no chunking): "flushes in chunks" ([25] not
 *     [10, 10, 5]), the mixed-failure count test and the function-level
 *     6-writes assertion fail.
 *   - start-interval pacing removed: "never starts two rows closer than the
 *     interval" fails.
 *   - clone-watch-enrich-attribution.ts restored from origin/main (the
 *     per-alert step loop): "runs ONE enrich step" fails with 60
 *     `enrich-<id>` step names.
 *   - finish set to 8m: inngestFinishBudgets.test.ts fails (480s < 530s floor).
 */

import {
  runEnrichBatch,
  type AttributionWrite,
  type EnrichBatchRow,
} from "@/lib/clone-watch/enrich-attribution-batch";

const rowsOf = (n: number): EnrichBatchRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    candidate_domain: `c${i + 1}.example`,
  }));

/** A tiny DB: which ids have attribution, with the RPC's IS NULL guard. */
function fakeDb(initiallyEnriched: number[] = []) {
  const enriched = new Set<number>(initiallyEnriched);
  const flushes: number[][] = [];
  return {
    enriched,
    flushes,
    readBack: async (ids: number[]) =>
      new Set(ids.filter((id) => !enriched.has(id))),
    flush: async (writes: AttributionWrite<unknown>[]) => {
      flushes.push(writes.map((w) => w.id));
      let n = 0;
      for (const w of writes) {
        if (!enriched.has(w.id)) {
          enriched.add(w.id);
          n++;
        }
      }
      return { written: n };
    },
  };
}

const never = { expired: () => false };
const noPace = { minStartIntervalMs: 0 };

describe("runEnrichBatch", () => {
  it("skips rows a previous attempt already wrote (idempotency read-back)", async () => {
    const db = fakeDb([2, 4, 6, 8, 10]);
    const enrich = vi.fn(async (r: EnrichBatchRow) => ({
      id: r.id,
      attribution: {},
      campaign_key: null,
    }));
    const out = await runEnrichBatch({
      rows: rowsOf(10),
      budget: never,
      readBack: db.readBack,
      enrich,
      flush: db.flush,
      ...noPace,
    });
    expect(enrich.mock.calls.map(([r]) => r.id).sort((a, b) => a - b)).toEqual([
      1, 3, 5, 7, 9,
    ]);
    expect(out).toMatchObject({
      pending: 10,
      alreadyEnriched: 5,
      attempted: 5,
      written: 5,
      notReachedBudget: 0,
    });
  });

  it("throws on a failed read-back instead of re-paying every lookup blind", async () => {
    const enrich = vi.fn();
    await expect(
      runEnrichBatch({
        rows: rowsOf(3),
        budget: never,
        readBack: async () => {
          throw new Error("read-back failed: timeout");
        },
        enrich,
        flush: async () => ({ written: 0 }),
        ...noPace,
      }),
    ).rejects.toThrow("read-back failed");
    expect(enrich).not.toHaveBeenCalled();
  });

  it("flushes in chunks, so a killed step loses at most one chunk", async () => {
    const db = fakeDb();
    const out = await runEnrichBatch({
      rows: rowsOf(25),
      budget: never,
      readBack: db.readBack,
      enrich: async (r) => ({ id: r.id, attribution: {}, campaign_key: null }),
      flush: db.flush,
      flushEvery: 10,
      concurrency: 1,
      ...noPace,
    });
    expect(db.flushes.map((f) => f.length)).toEqual([10, 10, 5]);
    expect(out.written).toBe(25);
  });

  it("a retry after a partial attempt looks every row up exactly once", async () => {
    const db = fakeDb();
    const lookups: number[] = [];
    const enrich = async (r: EnrichBatchRow) => {
      lookups.push(r.id);
      return { id: r.id, attribution: {}, campaign_key: null };
    };
    // Attempt 1 dies after 12 rows (modelled as the budget closing): the
    // first chunk of 10 and the tail of 2 are flushed.
    let started = 0;
    const first = await runEnrichBatch({
      rows: rowsOf(20),
      budget: { expired: () => started >= 12 },
      readBack: db.readBack,
      enrich: async (r) => {
        started++;
        return enrich(r);
      },
      flush: db.flush,
      flushEvery: 10,
      concurrency: 1,
      ...noPace,
    });
    expect(first.notReachedBudget).toBe(8);
    // Attempt 2 (the step's retry) re-reads and only does the rest.
    const second = await runEnrichBatch({
      rows: rowsOf(20),
      budget: never,
      readBack: db.readBack,
      enrich,
      flush: db.flush,
      flushEvery: 10,
      concurrency: 1,
      ...noPace,
    });
    expect(second).toMatchObject({
      alreadyEnriched: 12,
      attempted: 8,
      written: 8,
    });
    expect(lookups.slice().sort((a, b) => a - b)).toEqual(
      rowsOf(20).map((r) => r.id),
    );
  });

  it("never starts two rows closer than the interval, across all workers", async () => {
    let clock = 0;
    const starts: number[] = [];
    const db = fakeDb();
    await runEnrichBatch({
      rows: rowsOf(9),
      budget: never,
      readBack: db.readBack,
      enrich: async (r) => {
        starts.push(clock);
        await Promise.resolve();
        return { id: r.id, attribution: {}, campaign_key: null };
      },
      flush: db.flush,
      concurrency: 4,
      minStartIntervalMs: 3_000,
      now: () => clock,
      // A fake timer: wakes in FIFO order at the caller's target time, so the
      // shared clock only moves forward.
      sleep: (ms) => {
        const target = clock + ms;
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            clock = Math.max(clock, target);
            resolve();
          }, 0),
        );
      },
    });
    starts.sort((a, b) => a - b);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(gaps.every((g) => g >= 3_000)).toBe(true);
    // 20 starts/min: whoisjson's per-minute cap, even if every row fell back.
    expect(starts.length).toBe(9);
  });

  it("keeps at most `concurrency` rows in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const db = fakeDb();
    await runEnrichBatch({
      rows: rowsOf(12),
      budget: never,
      readBack: db.readBack,
      enrich: async (r) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((res) => setTimeout(res, 1));
        inFlight--;
        return { id: r.id, attribution: {}, campaign_key: null };
      },
      flush: db.flush,
      concurrency: 4,
      ...noPace,
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("counts a lookup throw, a failed chunk write and a raced write apart, and never aborts", async () => {
    const enriched = new Set<number>([3]); // row 3 enriched between read-back and write
    const out = await runEnrichBatch({
      rows: rowsOf(6),
      budget: never,
      readBack: async (ids) => new Set(ids), // all null at read-back time
      enrich: async (r) => {
        if (r.id === 2) throw new Error("rdap exploded");
        return { id: r.id, attribution: {}, campaign_key: null };
      },
      flush: async (writes) => {
        if (writes.some((w) => w.id === 5)) return { error: "PGRST202" };
        return { written: writes.filter((w) => !enriched.has(w.id)).length };
      },
      flushEvery: 2,
      concurrency: 1,
      ...noPace,
    });
    // rows: 1 ok, 2 throws, [1,3] flushed → 3 raced; [4,5] errors; [6] ok.
    expect(out).toMatchObject({
      attempted: 6,
      lookupFailed: 1,
      written: 2,
      writeSkipped: 1,
      writeFailed: 2,
    });
  });

  it("leaves rows the budget did not reach for tomorrow, and says so", async () => {
    const enrich = vi.fn(async (r: EnrichBatchRow) => ({
      id: r.id,
      attribution: {},
      campaign_key: null,
    }));
    const db = fakeDb();
    const out = await runEnrichBatch({
      rows: rowsOf(5),
      budget: { expired: () => true },
      readBack: db.readBack,
      enrich,
      flush: db.flush,
      ...noPace,
    });
    expect(enrich).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      notReachedBudget: 5,
      deadlineHit: true,
      written: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Function level: the fan-out is gone.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  log: vi.fn(),
  enrich: vi.fn(),
  lookupReg: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
  elapsedSinceTrigger: () => 0,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async () => false,
  logCost: mocks.log,
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: (_t, k) => k !== "cloneWatchKitPivots" }),
}));
vi.mock("@askarthur/scam-engine/urlscan-search", () => ({
  searchURLScan: vi.fn(),
}));
vi.mock("@/lib/clone-watch/enrich-attribution", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/clone-watch/enrich-attribution")
  >()),
  enrichCloneAttribution: mocks.enrich,
}));
vi.mock("@askarthur/scam-engine/domain-registration", () => ({
  lookupDomainRegistration: mocks.lookupReg,
}));
vi.mock(
  "@/lib/clone-watch/enrich-attribution-batch",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/clone-watch/enrich-attribution-batch")
    >()),
    ENRICH_MIN_START_INTERVAL_MS: 0,
  }),
);

import { cloneWatchEnrichAttribution } from "@/app/api/inngest/functions/clone-watch-enrich-attribution";

function query(result: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const m of [
    "select",
    "eq",
    "or",
    "is",
    "not",
    "gte",
    "lte",
    "order",
    "limit",
    "in",
    "update",
  ])
    chain[m] = () => chain;
  return chain;
}

describe("clone-watch-enrich-attribution (function)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enrich.mockImplementation(async (domain: string) => ({
      whois: { registrar: `reg-${domain}`, nameServers: [] },
      ct: null,
      ip_rep: null,
      hosting: { ip: null, country: null, asn: null },
      enriched_at: "2026-09-26T00:00:00Z",
    }));
    mocks.rpc.mockImplementation(
      async (_name: string, args: { p_rows: unknown[] }) => ({
        data: args.p_rows.length,
        error: null,
      }),
    );
  });

  it("runs ONE enrich step for the whole worklist and bulk-writes it", async () => {
    const pending = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      candidate_domain: `c${i + 1}.example`,
      urlscan_evidence: null,
    }));
    // select-pending (worklist, backlog count), read-back, backfill select.
    mocks.from
      .mockReturnValueOnce(query({ data: pending, error: null }))
      .mockReturnValueOnce(query({ count: 60, error: null }))
      .mockReturnValueOnce(query({ data: [], error: null })) // re-offer ids
      .mockReturnValueOnce(query({ count: 0, error: null })) // re-offer count
      .mockReturnValueOnce(
        query({ data: pending.map((p) => ({ id: p.id })), error: null }),
      )
      .mockReturnValue(query({ data: [], error: null }));
    const names: string[] = [];
    const step = {
      run: async (name: string, fn: () => unknown) => {
        names.push(name);
        return fn();
      },
    };
    const res = (await (
      cloneWatchEnrichAttribution as unknown as (
        ctx: unknown,
      ) => Promise<Record<string, unknown>>
    )({
      event: { ts: Date.now(), data: {} },
      step,
    })) as Record<string, unknown>;

    expect(names.filter((n) => n.startsWith("enrich"))).toEqual([
      "enrich-batch",
    ]);
    // select-pending, enrich-batch, backfill, log-outcome — and NO
    // whois-reoffer step: nothing was due (#1253 review: the step is
    // scheduled only when select-pending returns due ids).
    expect(names).not.toContain("whois-reoffer");
    expect(names.length).toBeLessThanOrEqual(5);
    expect(mocks.enrich).toHaveBeenCalledTimes(60);
    const writes = mocks.rpc.mock.calls.filter(
      ([n]) => n === "apply_clone_alert_attributions",
    );
    expect(writes.length).toBe(6); // 60 rows / ENRICH_FLUSH_EVERY (10)
    const first = (
      writes[0]![1] as { p_rows: Array<{ campaign_key: unknown }> }
    ).p_rows[0]!;
    expect(typeof first.campaign_key).toBe("string"); // cloneCampaigns on
    expect(res).toMatchObject({ ok: true, candidates: 60, enriched: 60 });
    const outcome = mocks.log.mock.calls
      .map(
        (c) => c[0] as { feature?: string; metadata?: Record<string, unknown> },
      )
      .find((r) => r.feature === "shopfront_clone_enrich");
    expect(outcome?.metadata).toMatchObject({
      pending: 60,
      enriched: 60,
      already_enriched: 0,
      write_failed: 0,
    });
  });

  it("schedules no enrich step on an empty worklist", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ count: 0, error: null }))
      .mockReturnValue(query({ data: [], error: null }));
    const names: string[] = [];
    await (
      cloneWatchEnrichAttribution as unknown as (
        ctx: unknown,
      ) => Promise<unknown>
    )({
      event: { ts: Date.now(), data: {} },
      step: {
        run: async (name: string, fn: () => unknown) => {
          names.push(name);
          return fn();
        },
      },
    });
    expect(names).not.toContain("enrich-batch");
    expect(mocks.enrich).not.toHaveBeenCalled();
  });
});

/**
 * #1253 at the function level: a deferred WHOIS is written AND stamped, and
 * the re-offer step merges only `whois` for due rows through its own RPC.
 *
 * Go-red record (2026-09-27, each reverted → failed → restored):
 *   - `attribution_retry_after: retryAfter` dropped from the enrich write:
 *     "stamps a deferred WHOIS" fails (undefined, not the retry instant).
 *   - the whois-reoffer step short-circuited to NO_REOFFER (as if removed):
 *     "re-offers due rows" fails (no apply_clone_alert_whois_reoffers call).
 *   - the `reofferSel.ids.length === 0` skip removed (step always scheduled):
 *     "runs ONE enrich step…" fails on `not.toContain("whois-reoffer")`.
 *   - a failed re-offer select recorded as due 0 instead of null: "a failed
 *     re-offer select" fails.
 */
describe("clone-watch-enrich-attribution — WHOIS deferral (#1253)", () => {
  const run = (step: unknown) =>
    (
      cloneWatchEnrichAttribution as unknown as (
        ctx: unknown,
      ) => Promise<Record<string, unknown>>
    )({ event: { ts: Date.now(), data: {} }, step });
  const step = {
    run: async (_name: string, fn: () => unknown) => fn(),
  };
  const outcomeRow = () =>
    mocks.log.mock.calls
      .map(
        (c) => c[0] as { feature?: string; metadata?: Record<string, unknown> },
      )
      .find((r) => r.feature === "shopfront_clone_enrich")?.metadata;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(
      async (_name: string, args: { p_rows: unknown[] }) => ({
        data: args.p_rows.length,
        error: null,
      }),
    );
  });

  it("stamps a deferred WHOIS with its retry instant — and still writes the dossier", async () => {
    const pending = [
      { id: 1, candidate_domain: "a.example", urlscan_evidence: null },
      { id: 2, candidate_domain: "b.example", urlscan_evidence: null },
    ];
    mocks.enrich.mockImplementation(async (domain: string) => ({
      whois:
        domain === "a.example"
          ? {
              registrar: null,
              nameServers: [],
              source: "deferred",
              retryAfter: "2026-10-01T00:00:00.000Z",
              deferralReason: "quota_deferred",
            }
          : { registrar: "reg", nameServers: [], source: "rdap" },
      ct: null,
      ip_rep: null,
      hosting: { ip: null, country: null, asn: null },
      enriched_at: "2026-09-27T00:00:00Z",
    }));
    mocks.from
      .mockReturnValueOnce(query({ data: pending, error: null }))
      .mockReturnValueOnce(query({ count: 2, error: null }))
      .mockReturnValueOnce(query({ data: [], error: null })) // re-offer ids
      .mockReturnValueOnce(query({ count: 0, error: null })) // re-offer count
      .mockReturnValueOnce(query({ data: [{ id: 1 }, { id: 2 }], error: null }))
      .mockReturnValue(query({ data: [], count: 0, error: null }));
    await run(step);

    const rows = mocks.rpc.mock.calls
      .filter(([n]) => n === "apply_clone_alert_attributions")
      .flatMap(
        ([, a]) =>
          (a as { p_rows: Array<Record<string, unknown>> }).p_rows,
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(1)?.attribution_retry_after).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(byId.get(1)?.attribution).toBeTruthy(); // written, not held back
    expect(byId.get(2)?.attribution_retry_after).toBeNull();
    expect(outcomeRow()).toMatchObject({ whois_deferred: 1, enriched: 2 });
  });

  it("re-offers due rows, merging only whois through its own RPC", async () => {
    mocks.lookupReg.mockResolvedValue({
      registrar: "NameCheap",
      registrarAbuseEmail: null,
      registrantCountry: null,
      createdDate: "2026-09-01",
      expiresDate: null,
      nameServers: [],
      isPrivate: false,
      raw: null,
      statuses: [],
      registrarIanaId: null,
      abuseContact: null,
      source: "rdap",
    });
    const due = [
      {
        id: 7,
        candidate_domain: "late.example",
        attribution: {
          whois: { registrar: null, nameServers: [], source: "whoisjson" },
          kit_siblings: { siblings: ["x"] },
        },
      },
    ];
    mocks.from
      .mockReturnValueOnce(query({ data: [], error: null })) // enrich worklist
      .mockReturnValueOnce(query({ count: 0, error: null })) // its backlog
      .mockReturnValueOnce(query({ data: [{ id: 7 }], error: null })) // re-offer ids
      .mockReturnValueOnce(query({ count: 1, error: null })) // re-offer backlog
      .mockReturnValueOnce(query({ data: due, error: null })) // step re-read by id
      .mockReturnValue(query({ data: [], error: null }));
    const res = await run(step);

    expect(mocks.lookupReg).toHaveBeenCalledWith("late.example", {
      priority: "batch",
    });
    const call = mocks.rpc.mock.calls.find(
      ([n]) => n === "apply_clone_alert_whois_reoffers",
    );
    const el = (call![1] as { p_rows: Array<Record<string, unknown>> })
      .p_rows[0]!;
    expect(el.id).toBe(7);
    expect(el.retry_after).toBeNull(); // answered → mark cleared
    expect((el.whois as { registrar: string }).registrar).toBe("NameCheap");
    // Only the whois block travels; the RPC merges it (kit_siblings kept).
    expect(el).not.toHaveProperty("attribution");
    expect(el).not.toHaveProperty("kit_siblings");
    expect(res).toMatchObject({ whoisReoffered: 1, whoisResolved: 1 });
    expect(outcomeRow()).toMatchObject({
      reason: "nothing_pending",
      whois_reoffer_due: 1,
      whois_reoffer_backlog: 1,
      whois_reoffered: 1,
      whois_resolved: 1,
      whois_redeferred: 0,
      whois_abandoned: 0,
    });
  });

  it("a failed re-offer select schedules no step and records due as null (unknown)", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: [], error: null })) // enrich worklist
      .mockReturnValueOnce(query({ count: 0, error: null })) // its backlog
      .mockReturnValueOnce(query({ data: null, error: { message: "boom" } })) // re-offer ids
      .mockReturnValueOnce(query({ count: null, error: null })) // re-offer count
      .mockReturnValue(query({ data: [], error: null }));
    const names: string[] = [];
    await run({
      run: async (name: string, fn: () => unknown) => {
        names.push(name);
        return fn();
      },
    });
    expect(names).not.toContain("whois-reoffer");
    expect(mocks.lookupReg).not.toHaveBeenCalled();
    expect(outcomeRow()).toMatchObject({
      whois_reoffer_due: null,
      whois_reoffered: 0,
    });
  });
});
