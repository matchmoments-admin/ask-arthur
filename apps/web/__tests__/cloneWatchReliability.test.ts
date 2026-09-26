import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), send: vi.fn(), submit: vi.fn(), log: vi.fn(),
  elapsed: vi.fn(), pages: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({ inngest: {
  createFunction: (_config: unknown, _trigger: unknown, handler: unknown) => handler,
  send: mocks.send,
} }));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_config: unknown, handler: unknown) => handler,
  elapsedSinceTrigger: mocks.elapsed,
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@askarthur/supabase/paginate", () => ({ fetchAllRows: mocks.pages }));
// `logCost` here is what `recordLaneOutcome` (lane-outcome.ts) writes through — the
// lane Outcome Rows the assertions below read.
vi.mock("@askarthur/scam-engine/cost-log", () => ({ isFeatureBraked: async () => false, isFeatureBrakedOrUnknown: async () => false, logCost: mocks.log }));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: new Proxy({}, { get: () => true }) }));
vi.mock("@askarthur/scam-engine/urlscan", () => ({ retrieveURLScanDetailed: vi.fn() }));
// The lanes call submitCandidateBatch; route its per-row submit through the mock
// so the REAL outcome → counter mapping runs under these assertions.
vi.mock("@/lib/clone-watch/urlscan-submit-one", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clone-watch/urlscan-submit-one")>();
  return {
    ...actual,
    submitCloneCandidate: mocks.submit,
    submitCandidateBatch: (...[c, b, o]: Parameters<typeof actual.submitCandidateBatch>) =>
      actual.submitCandidateBatch(c, b, { ...o, submitOne: mocks.submit }),
  };
});
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.log, logCostAsync: mocks.log }));

import { cloneWatchUrlscanRetrieve } from "@/app/api/inngest/functions/clone-watch-urlscan-retrieve";
import { retrieveURLScanDetailed } from "@askarthur/scam-engine/urlscan";
import { cloneWatchLifecycleRecheck } from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";
import { cloneWatchUrlscanSubmit } from "@/app/api/inngest/functions/clone-watch-urlscan-submit";
import { loadCardInputs } from "@/lib/clone-watch/report-card-data";
import { toCloneDetail } from "@/lib/clone-watch/clone-metrics";
import { cloneDetectionsFromMetrics } from "@/lib/email/brand-stewardship-clone-detections";

const invoke = (handler: unknown) => (handler as (ctx: unknown) => Promise<unknown>)({
  event: { ts: Date.now(), data: {} }, step: { run: (_name: string, fn: () => unknown) => fn() },
});
function query(result: unknown) {
  const chain: Record<string, unknown> = { then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ["select", "not", "is", "limit", "update", "in", "gt", "lt", "eq", "order", "maybeSingle"])
    chain[method] = () => chain;
  return chain;
}
// #1229/v331: the recheck stamp is ONE array RPC per run. Returns the ids it
// stamped, or null when it was not called. Asserts there is at most one call —
// a regression to the per-id loop fails here, not only in the ids.
function stampedIds(): number[] | null {
  const calls = mocks.rpc.mock.calls.filter(([name]) =>
    name === "mark_clone_alerts_rechecked" || name === "mark_clone_alert_rechecked");
  expect(calls.every(([name]) => name === "mark_clone_alerts_rechecked")).toBe(true);
  expect(calls.length).toBeLessThanOrEqual(1);
  return calls.length ? (calls[0]![1] as { p_alert_ids: number[] }).p_alert_ids : null;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("URLSCAN_API_KEY", "test");
  mocks.elapsed.mockReturnValue(0);
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.from.mockReturnValue(query({ data: [], count: 0, error: null }));
  mocks.submit.mockResolvedValue({ kind: "submitted" });
});

describe("worker recovery", () => {
  it("emits a persisted weaponisation when there are no pending scans", async () => {
    mocks.from.mockReturnValueOnce(query({ data: [{ id: 7, candidate_domain: "clone.example", candidate_url: "https://clone.example", recheck_count: 0 }], error: null }));
    await invoke(cloneWatchUrlscanRetrieve);
    expect(mocks.send).toHaveBeenCalledWith([expect.objectContaining({ data: expect.objectContaining({ alertId: 7 }) })]);
    expect(mocks.from).toHaveBeenCalledTimes(3); // read event, stamp event, outcome probe
  });
  // #1231: retrieve runs at width 3 — the first 429 must stop every worker
  // (the quota is key-wide), and every row not read counts as not-our-signal.
  it("stops all retrieve workers on the first 429 and counts every unread row", async () => {
    const pending = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, candidate_url: `https://c${i}.example`, candidate_domain: `c${i}.example`,
      urlscan_uuid: `u${i}`, urlscan_evidence: null,
    }));
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "list_clone_alerts_pending_urlscan_retrieve"
        ? { data: pending, error: null }
        : { data: null, error: null },
    );
    const retrieve = vi.mocked(retrieveURLScanDetailed);
    retrieve.mockReset();
    let calls = 0;
    retrieve.mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 1));
      return { kind: "quota_exhausted" } as never;
    });
    await invoke(cloneWatchUrlscanRetrieve);
    expect(calls).toBeLessThanOrEqual(3); // only the rows already in flight
    const outcome = mocks.log.mock.calls
      .map((c) => c[0] as { operation?: string; metadata?: Record<string, unknown> })
      .find((r) => r.metadata && "skipped_not_our_signal" in r.metadata);
    expect(outcome?.metadata).toMatchObject({
      classified: 0,
      skipped_not_our_signal: 12,
      quota_exhausted: true,
      cap: 100,
      cap_reached: false,
    });
  });
  it("fails visibly on a broken retrieval worklist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "DB unavailable" } });
    await expect(invoke(cloneWatchUrlscanRetrieve)).rejects.toThrow("DB unavailable");
  });
  it("fails visibly on a broken recheck worklist instead of reporting nothing_due", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "list_clone_alerts_for_recheck"
        ? { data: null, error: { message: "worklist read failed" } }
        : { data: 0, error: null },
    );
    await expect(invoke(cloneWatchLifecycleRecheck)).rejects.toThrow("worklist read failed");
    expect(mocks.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "nothing_due" }) }),
    );
  });
  it("does not mark candidates skipped by the wall-clock guard as rechecked", async () => {
    const candidates = [1, 2].map(id => ({ id, candidate_url: `https://clone${id}.example`, candidate_domain: `clone${id}.example`, lifecycle_state: "monitoring", last_rechecked_at: null }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? candidates : null, error: null }));
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.submit.mockImplementation(async () => { now += 500_000; return { kind: "submitted" }; });
    await invoke(cloneWatchLifecycleRecheck);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(stampedIds()).toEqual([1]);
  });
  it("does not mark a rate-limited submission as rechecked (quota says nothing about the URL)", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? [{ id: 1, lifecycle_state: "monitoring" }] : null, error: null }));
    mocks.submit.mockResolvedValue({ kind: "rate_limited" });
    await invoke(cloneWatchLifecycleRecheck);
    // No ids → no RPC at all (not an empty-array call).
    expect(stampedIds()).toBeNull();
    // …and it is counted as quota, not a failure (2026-09-24: this lane used to
    // fold 429s into submit_failed, which paged the digest as silent_zero).
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      feature: "shopfront_clone_recheck",
      metadata: expect.objectContaining({ rechecked: 0, submit_failed: 0, rate_limited: 1 }),
    }));
  });
  // #1127 stamped only successes. A row urlscan refuses (400, no DNS) then kept
  // its stale last_rechecked_at, stayed at the head of the staleness-ordered
  // worklist, and was re-attempted every run: by 2026-09-16 the same 50 dead
  // domains were the entire batch and nothing live was rechecked. The stamp
  // records "we looked", and v277's 168h dead-domain cadence keys on it.
  it("marks a failed submission as rechecked so it rotates instead of starving the worklist", async () => {
    const candidates = [1, 2].map(id => ({ id, candidate_url: `https://clone${id}.example`, candidate_domain: `clone${id}.example`, lifecycle_state: "declined", last_rechecked_at: null }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? candidates : null, error: null }));
    mocks.submit
      .mockResolvedValueOnce({ kind: "submit_failed", error: "rejected" })
      .mockResolvedValueOnce({ kind: "submitted" });
    await invoke(cloneWatchLifecycleRecheck);
    expect(stampedIds()).toEqual([1, 2]);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      feature: "shopfront_clone_recheck",
      metadata: expect.objectContaining({ rechecked: 2, submitted: 1, submit_failed: 1 }),
    }));
  });
  // 2026-09-24: a DNS-precheck skip is counted apart from real failures (the
  // saving was invisible inside submit_failed) but still stamped — v277's
  // dead-domain cadence keys on last_rechecked_at.
  it("counts a DNS no-host skip as dns_skipped, not submit_failed, and still stamps it", async () => {
    const candidates = [1, 2].map(id => ({ id, candidate_url: `https://c${id}.example`, candidate_domain: `c${id}.example`, lifecycle_state: "declined", last_rechecked_at: null }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? candidates : null, error: null }));
    mocks.submit
      .mockResolvedValueOnce({ kind: "dns_no_host", error: "dns_no_host_precheck" })
      .mockResolvedValueOnce({ kind: "submitted" });
    await invoke(cloneWatchLifecycleRecheck);
    expect(stampedIds()).toEqual([1, 2]);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      feature: "shopfront_clone_recheck",
      metadata: expect.objectContaining({ rechecked: 2, submitted: 1, submit_failed: 0, dns_skipped: 1 }),
    }));
  });
  it("marks a submission that threw as rechecked", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? [{ id: 9, lifecycle_state: "declined" }] : null, error: null }));
    mocks.submit.mockRejectedValueOnce(new Error("record scan failure failed: boom"));
    await invoke(cloneWatchLifecycleRecheck);
    expect(stampedIds()).toEqual([9]);
  });
  // #1229/v331: one array RPC per run, however large the batch — the loop of
  // per-id round trips it replaces sat inside a held Inngest slot. A throw on
  // the batch write still fails the step (retry), never a silent half-stamp.
  // Go-red (2026-09-26): restoring the per-id loop in mark-rechecked fails
  // stampedIds()'s every-name and ≤1-call assertions here and above.
  it("stamps the whole attempted batch in one RPC, and throws when it fails", async () => {
    // Three rows: the submit lane paces starts 1.1s apart, so more is slow.
    const candidates = [1, 2, 3].map(id => ({ id, candidate_url: `https://c${id}.example`, candidate_domain: `c${id}.example`, lifecycle_state: "declined", last_rechecked_at: null }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? candidates : null, error: null }));
    await invoke(cloneWatchLifecycleRecheck);
    expect(stampedIds()?.slice().sort()).toEqual([1, 2, 3]);

    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async name => name === "list_clone_alerts_for_recheck"
      ? { data: candidates.slice(0, 1), error: null }
      : name === "mark_clone_alerts_rechecked"
        ? { data: null, error: { message: "boom" } }
        : { data: null, error: null });
    await expect(invoke(cloneWatchLifecycleRecheck)).rejects.toThrow("mark_clone_alerts_rechecked failed for 1 alerts: boom");
  });
  // From #1124 to #1141 the submit loop's budget was a spanning one measured
  // from event.ts. A cron event's ts is the scheduled tick; the fn reaches
  // submit-batch ~200s+ later on the :00 fleet pileup, so the guard was already
  // expired at index 0 and the lane processed 0 of 75 candidates every day
  // from Sep 12. The loop runs inside ONE step, so its clock must start at
  // step entry: an event.ts long in the past must not stop it submitting.
  it("submits the batch even when the trigger tick is older than the wall-clock budget", async () => {
    mocks.rpc.mockImplementation(async name => ({
      data: name === "list_clone_alerts_pending_urlscan_submit"
        ? [{ id: 1, candidate_url: "https://clone1.example", candidate_domain: "clone1.example" }]
        : name === "mark_stale_clone_alerts_dormant" ? 0 : null,
      error: null,
    }));
    const handler = cloneWatchUrlscanSubmit as unknown as (ctx: unknown) => Promise<unknown>;
    await handler({
      event: { ts: Date.now() - 30 * 60_000, data: {} },
      step: { run: (_name: string, fn: () => unknown) => fn() },
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      operation: "submit_batch",
      metadata: expect.objectContaining({ submitted: 1 }),
    }));
  });
  it("recheck submits even when the trigger tick is older than the wall-clock budget", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? [{ id: 1, candidate_url: "https://clone1.example", candidate_domain: "clone1.example", lifecycle_state: "monitoring" }] : null, error: null }));
    const handler = cloneWatchLifecycleRecheck as unknown as (ctx: unknown) => Promise<unknown>;
    await handler({
      event: { ts: Date.now() - 30 * 60_000, data: {} },
      step: { run: (_name: string, fn: () => unknown) => fn() },
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});

describe("report evidence", () => {
  it("rejects a truncated monthly cohort instead of publishing partial totals", async () => {
    mocks.pages.mockResolvedValue({ rows: [], truncated: true, error: null });
    await expect(loadCardInputs("2026-08")).rejects.toThrow("incomplete");
  });
  it("rejects a failed monthly cohort read", async () => {
    mocks.pages.mockResolvedValue({ rows: [], truncated: false, error: { message: "unavailable" } });
    await expect(loadCardInputs("2026-08")).rejects.toThrow("unavailable");
  });
  it("does not infer live observation from a vendor decline, including legacy snapshots", () => {
    const detail = toCloneDetail({ id: 1, candidate_domain: "clone.example", inferred_target_domain: "brand.example", urlscan_classification: null, urlscan_evidence: null, attribution: null, submitted_to: null, lifecycle_state: "declined", netcraft_declined_at: "2026-09-01" });
    expect(detail.still_live_as_of).toBeNull();
    expect(cloneDetectionsFromMetrics({ detected: 1, domains: [{ ...detail, still_live_as_of: "2026-09-01" }] })?.domains[0].stillLiveAsOf).toBeNull();
  });
});

// Keep internal confirmation separate from a real recipient delivery.
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({ sendAdminTelegramMessage: vi.fn() }));
vi.mock("@/lib/clone-watch/feed-entity", () => ({ feedCloneEntity: async () => {} }));
vi.mock("@/lib/clone-watch/liveness", () => ({ isCandidateLive: async () => true }));
import { cloneWatchNotifyBrand } from "@/app/api/inngest/functions/clone-watch-notify-brand";
import { cloneWatchAutoTriage } from "@/app/api/inngest/functions/clone-watch-auto-triage";

it.each(["shadow_summary", "fraud_inbox"])("handles a legacy %s notification stamp correctly", async (channel) => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  const run = cloneWatchNotifyBrand as unknown as (ctx: unknown) => Promise<unknown>;
  mocks.from.mockReturnValue(query({ data: { submitted_to: { brand_notification: { channel_type: channel, status: "sent" } } }, error: null }));
  await run({ event: { data: {
    alertId: 1, brand: "brand.example", candidateDomain: "clone.example",
    candidateUrl: "https://clone.example", severityTier: "medium", signalType: "levenshtein", score: 0.9,
    triagedAt: "2026-09-08T00:00:00Z",
  } }, step: { run: (name: string, fn: () => unknown) => name === "load-brand-contact"
    ? { brand: "Brand", channel_type: "fraud_inbox", recipient: "abuse@brand.example" }
    : fn() } });
  expect(mocks.rpc.mock.calls.some(([name]) => name === "enqueue_clone_alert_notification")).toBe(channel === "shadow_summary");
});

it("records confirmation without a delivery stamp when shadow email is disabled", async () => {
  vi.stubEnv("CLONE_WATCH_SHADOW_RECIPIENT", "");
  vi.stubEnv("BRAND_STEWARDSHIP_SHADOW_RECIPIENT", "");
  const run = cloneWatchAutoTriage as unknown as (ctx: unknown) => Promise<unknown>;
  await run({ step: { run: (name: string, fn: () => unknown) => {
    if (name === "auto-park-weak-non-clones") return 0;
    if (name === "select-eligible") return [{ id: 1, candidate_domain: "clone.example", candidate_url: "https://clone.example", inferred_target_domain: "brand.example" }];
    return fn();
  } } });
  const stamp = mocks.rpc.mock.calls.find(([name]) => name === "merge_clone_alert_submission")?.[1];
  expect(stamp?.p_key).toBe("auto_triage");
  expect(stamp?.p_value.status).toBe("confirmed");
  expect(stamp?.p_value.sent_at).toBeUndefined();
});

it.each([
  ["clone_alert_recipient_is_suppressed", "suppression lookup failed"],
  ["enqueue_clone_alert_notification", "notification enqueue failed"],
  ["merge_clone_alert_submission", "notification stamp failed"],
])("retries %s failures instead of falsely completing notification", async (failedRpc, message) => {
  mocks.rpc.mockImplementation(async name => ({ data: null, error: name === failedRpc ? { message: "injected DB failure" } : null }));
  mocks.from.mockReturnValue(query({ data: { submitted_to: {} }, error: null }));
  const run = cloneWatchNotifyBrand as unknown as (ctx: unknown) => Promise<unknown>;
  await expect(run({ event: { data: {
    alertId: 1, brand: "brand.example", candidateDomain: "clone.example",
    candidateUrl: "https://clone.example", severityTier: "medium", signalType: "levenshtein", score: 0.9,
    triagedAt: "2026-09-08T00:00:00Z",
  } }, step: { run: (name: string, fn: () => unknown) => name === "load-brand-contact"
    ? { brand: "Brand", channel_type: "fraud_inbox", recipient: "abuse@brand.example" }
    : fn() } })).rejects.toThrow(message);
  if (failedRpc !== "merge_clone_alert_submission")
    expect(mocks.rpc.mock.calls.some(([name]) => name === "merge_clone_alert_submission")).toBe(false);
  if (failedRpc === "clone_alert_recipient_is_suppressed")
    expect(mocks.rpc.mock.calls.some(([name]) => name === "enqueue_clone_alert_notification")).toBe(false);
});

vi.mock("@/lib/adminAuth", () => ({ requireAdmin: async () => {}, getAdminRateLimitKey: async () => null }));
import { POST as triage } from "@/app/api/admin/clone-watch/triage/route";
it("does not inline-enqueue when suppression lookup fails during operator triage", async () => {
  mocks.from
    .mockReturnValueOnce(query({ data: { id: 1, inferred_target_domain: "brand.example", candidate_domain: "clone.example", candidate_url: "https://clone.example", severity_tier: "medium", signals: [] }, error: null }))
    .mockReturnValueOnce(query({ data: { brand: "Brand", channel_type: "fraud_inbox", recipient: "abuse@brand.example" }, error: null }));
  mocks.rpc.mockImplementation(async name => ({ data: null, error: name === "clone_alert_recipient_is_suppressed" ? { message: "injected suppression failure" } : null }));
  const response = await triage(new Request("https://example.test/api/admin/clone-watch/triage", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertId: 1, status: "tp_confirmed" }),
  }));
  expect(response.status).toBe(200); // confirmation remains saved; durable consumer can retry
  expect((await response.json()).enqueuedInline).toBe(false);
  expect(mocks.rpc.mock.calls.some(([name]) => name === "enqueue_clone_alert_notification")).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
