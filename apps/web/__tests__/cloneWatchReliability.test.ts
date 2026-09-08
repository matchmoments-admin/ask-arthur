import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@askarthur/scam-engine/cost-log", () => ({ isFeatureBraked: async () => false }));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: new Proxy({}, { get: () => true }) }));
vi.mock("@askarthur/scam-engine/urlscan", () => ({ retrieveURLScanDetailed: vi.fn() }));
vi.mock("@/lib/clone-watch/urlscan-submit-one", () => ({ submitCloneCandidate: mocks.submit }));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.log, logCostAsync: mocks.log }));

import { cloneWatchUrlscanRetrieve } from "@/app/api/inngest/functions/clone-watch-urlscan-retrieve";
import { cloneWatchLifecycleRecheck } from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";
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
  it("fails visibly on a broken retrieval worklist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "DB unavailable" } });
    await expect(invoke(cloneWatchUrlscanRetrieve)).rejects.toThrow("DB unavailable");
  });
  it("does not mark candidates skipped by the wall-clock guard as rechecked", async () => {
    const candidates = [1, 2].map(id => ({ id, candidate_url: `https://clone${id}.example`, candidate_domain: `clone${id}.example`, lifecycle_state: "monitoring", last_rechecked_at: null }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? candidates : null, error: null }));
    mocks.elapsed.mockReturnValueOnce(0).mockReturnValue(500_000);
    await invoke(cloneWatchLifecycleRecheck);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "mark_clone_alert_rechecked")).toEqual([
      ["mark_clone_alert_rechecked", { p_alert_id: 1 }],
    ]);
  });
  it("does not mark rate-limited or failed submissions as completed", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "list_clone_alerts_for_recheck" ? [{ id: 1, lifecycle_state: "monitoring" }] : null, error: null }));
    mocks.submit.mockResolvedValue({ kind: "rate_limited" });
    await invoke(cloneWatchLifecycleRecheck);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "mark_clone_alert_rechecked")).toBe(false);
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
