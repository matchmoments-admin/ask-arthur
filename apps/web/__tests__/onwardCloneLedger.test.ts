import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR 6 of docs/plans/clone-watch-deepening-2026-09-23.md (ADR-0018 amendment
 * 2026-09-23): clone takedowns report through the ONE onward ledger.
 *
 * Before: shopfront-clone-enforcement-execute redeclared the APWG/OpenPhish
 * intakes, sent inline and recorded the send only in shopfront_takedown_attempts
 * — invisible to /admin/onward-reports, to brand stewardship, and to the
 * per-URL dedup. After: it is a producer into onward_report_log
 * (enqueue_onward_url_reports, v318) and the report.onward.<destination>
 * workers send, exactly as for a scam report.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  logCost: vi.fn(),
  resendSend: vi.fn(),
  flags: {} as Record<string, boolean>,
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
    send: mocks.send,
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: async () => false,
  isFeatureBrakedOrUnknown: async () => false,
  logCost: mocks.logCost,
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: (_t, k: string) => mocks.flags[k] ?? false }),
}));
vi.mock("@/lib/cost-telemetry", () => ({
  logCost: mocks.logCost,
  logCostAsync: mocks.logCost,
  PRICING: { RESEND_USD_PER_EMAIL: 0.0004 },
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({ warn: vi.fn(), flush: async () => {} }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => {} }));
vi.mock("@/lib/adminAuth", () => ({ requireAdmin: async () => {} }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.resendSend };
  },
}));

import { POST as adminEnforcementSend } from "@/app/api/admin/clone-watch/enforcement/send/route";
import { cloneWatchEnforcementExecute } from "@/app/api/inngest/functions/clone-watch-enforcement-execute";
import { onwardAutoReport } from "@/app/api/inngest/functions/onward-auto-report";
import { casePlans } from "@/app/api/inngest/functions/clone-watch-enforcement-plan";
import {
  aggregateOnwardByBrand,
  cloneBrandLabel,
} from "@/app/api/inngest/functions/report-brand-stewardship";
import { selectChannels } from "@/lib/clone-watch/enforcement/matrix";
import {
  APWG_INTAKE_EMAIL,
  OPENPHISH_INTAKE_EMAIL,
} from "@/lib/onward/destinations";
import { ONWARD_DEST_VALUES } from "@/lib/onward/submit";
import {
  runUrlBlocklistOnward,
  type OnwardStepCtx,
} from "@/lib/onward/url-blocklist-report";

type Handler = (ctx: unknown) => Promise<Record<string, unknown>>;
const invoke = (fn: unknown, data: unknown = {}) =>
  (fn as Handler)({
    event: { ts: Date.now(), data },
    step: { run: (_id: string, f: () => unknown) => f() },
    runId: "run-1",
  });

/** A thenable PostgREST builder stub resolving to `result`. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const m of ["select", "eq", "gte", "order", "limit", "update", "maybeSingle", "in", "not"]) {
    chain[m] = () => chain;
  }
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ONWARD_CANARY_RECIPIENT", "");
  for (const k of Object.keys(mocks.flags)) delete mocks.flags[k];
  mocks.from.mockReturnValue(query({ data: null, error: null }));
  mocks.resendSend.mockResolvedValue({ data: { id: "msg-1" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

// ── The intake addresses have ONE home ──────────────────────────────────────
describe("URL-blocklist intake addresses", () => {
  const ROOT = new URL("../", import.meta.url).pathname;
  const HOME = join(ROOT, "lib/onward/destinations.ts");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  }
  it("are declared as string literals only in lib/onward/destinations.ts", () => {
    const literal = new RegExp(
      `["'\`](${[OPENPHISH_INTAKE_EMAIL, APWG_INTAKE_EMAIL]
        .map((s) => s.replace(/[.@]/g, "\\$&"))
        .join("|")})["'\`]`,
    );
    const offenders = ["app", "lib", "components"]
      .flatMap((d) => files(join(ROOT, d)))
      .filter((p) => p !== HOME && literal.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });

  it("netcraft is a ledger destination, never a user-routable one (it has no worker)", () => {
    expect((ONWARD_DEST_VALUES as readonly string[]).includes("netcraft")).toBe(false);
  });
});

// ── enforcement-execute is a producer, not a sender ─────────────────────────
describe("shopfront-clone-enforcement-execute", () => {
  const alerts = [
    {
      clone_alert_id: 10,
      candidate_url: "https://evil-commbank.click/login?email=v@x.com",
      candidate_domain: "evil-commbank.click",
      target_brand_normalized: "commbank",
    },
  ];

  function rpcScript(overrides: Record<string, unknown> = {}) {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name in overrides) return { data: overrides[name], error: null };
      if (name === "count_todays_takedown_submissions") return { data: 0, error: null };
      if (name === "list_clone_alerts_pending_onward") return { data: alerts, error: null };
      if (name === "enqueue_onward_url_reports") {
        const rows = args.p_rows as Array<Record<string, unknown>>;
        return {
          data: rows.map((r, i) => ({
            id: `log-${i}`,
            source: r.source,
            scam_report_id: null,
            clone_alert_id: r.clone_alert_id,
            destination: r.destination,
            destination_key: r.destination_key,
            url_key: "evil-commbank.click/login",
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    });
  }

  function enableAll() {
    Object.assign(mocks.flags, {
      cloneEnforcement: true,
      cloneEnforceAutoBlocklist: true,
      onwardOpenphish: true,
      onwardApwg: true,
    });
  }

  it("enqueues onward_report_log rows and fires the shared onward workers — never sends, never writes a case", async () => {
    enableAll();
    rpcScript();
    const out = await invoke(cloneWatchEnforcementExecute);

    const enqueue = mocks.rpc.mock.calls.find(([n]) => n === "enqueue_onward_url_reports");
    expect(enqueue?.[1].p_rows).toEqual([
      {
        source: "clone_alert",
        clone_alert_id: 10,
        destination: "openphish",
        destination_key: OPENPHISH_INTAKE_EMAIL,
        url: alerts[0].candidate_url,
      },
      {
        source: "clone_alert",
        clone_alert_id: 10,
        destination: "apwg",
        destination_key: APWG_INTAKE_EMAIL,
        url: alerts[0].candidate_url,
      },
    ]);
    expect(mocks.send).toHaveBeenCalledWith([
      {
        // Deterministic per ledger row: a retried fire-events step is deduped
        // by Inngest instead of queueing a second send of the same row.
        id: "onward-log-0",
        name: "report.onward.openphish",
        data: {
          log_id: "log-0",
          scam_report_id: null,
          clone_alert_id: 10,
          destination_key: OPENPHISH_INTAKE_EMAIL,
          analysis_id: null,
        },
      },
      expect.objectContaining({ name: "report.onward.apwg" }),
    ]);
    // No inline email, no second ledger.
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("shopfront_takedown_attempts");
    expect(mocks.rpc.mock.calls.map(([n]) => n)).not.toContain("merge_takedown_case");
    expect(out).toMatchObject({ ok: true, enqueued: 2 });
  });

  it("records one enforcement.queued per enqueued row — the shared daily cap counts it", async () => {
    enableAll();
    rpcScript();
    await invoke(cloneWatchEnforcementExecute);
    const queued = mocks.logCost.mock.calls.filter(
      ([row]) => row.operation === "enforcement.queued",
    );
    expect(queued).toHaveLength(2);
    expect(queued.map(([row]) => row.provider).sort()).toEqual(["apwg", "openphish"]);
  });

  it("awaits every enforcement.queued row before the step returns (the cap reads them)", async () => {
    enableAll();
    rpcScript();
    let landed = 0;
    // A slow insert for the counted rows only; everything else resolves at once,
    // so a fire-and-forget write would still be pending when the run returns.
    mocks.logCost.mockImplementation((row: { operation: string }) =>
      row.operation === "enforcement.queued"
        ? new Promise<void>((r) => setTimeout(() => { landed++; r(); }, 30))
        : Promise.resolve(),
    );
    await invoke(cloneWatchEnforcementExecute);
    expect(landed).toBe(2);
  });

  it("fails CLOSED when the shared-cap counter errors — no worklist read, no enqueue", async () => {
    enableAll();
    rpcScript();
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) =>
      name === "count_todays_takedown_submissions"
        ? { data: null, error: { message: "statement timeout" } }
        : base(name, args),
    );
    await expect(invoke(cloneWatchEnforcementExecute)).rejects.toThrow(/count_todays_takedown_submissions/);
    expect(mocks.rpc.mock.calls.map(([n]) => n)).not.toContain("enqueue_onward_url_reports");
  });

  it("enqueues only destinations whose worker flag is on", async () => {
    enableAll();
    mocks.flags.onwardApwg = false;
    rpcScript();
    await invoke(cloneWatchEnforcementExecute);
    const list = mocks.rpc.mock.calls.find(([n]) => n === "list_clone_alerts_pending_onward");
    expect(list?.[1].p_destinations).toEqual(["openphish"]);
  });

  it("skips (no worklist read) when no destination worker is on", async () => {
    Object.assign(mocks.flags, { cloneEnforcement: true, cloneEnforceAutoBlocklist: true });
    rpcScript();
    const out = await invoke(cloneWatchEnforcementExecute);
    expect(out).toMatchObject({ skipped: true, reason: "no_enabled_destinations" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("list_clone_alerts_pending_onward", expect.anything());
  });

  it("divides the remaining daily cap by the destination count (one alert = one send per destination)", async () => {
    enableAll();
    rpcScript({ count_todays_takedown_submissions: 47 }); // 3 left of 50, 2 destinations
    await invoke(cloneWatchEnforcementExecute);
    const list = mocks.rpc.mock.calls.find(([n]) => n === "list_clone_alerts_pending_onward");
    expect(list?.[1].p_limit).toBe(1);
  });

  it("stops at the cap when the remainder cannot cover one alert on every destination", async () => {
    enableAll();
    rpcScript({ count_todays_takedown_submissions: 49 }); // 1 left, 2 destinations
    const out = await invoke(cloneWatchEnforcementExecute);
    expect(out).toMatchObject({ skipped: true, reason: "daily_submission_cap_reached" });
  });
});

// ── the human admin send shares the cap, and fails closed the same way ─────
describe("admin clone-enforcement send — shared daily cap", () => {
  it("refuses (503) when the counter errors instead of reading it as 0 used", async () => {
    mocks.flags.cloneEnforcement = true;
    mocks.from.mockImplementation((table: string) =>
      query({
        data:
          table === "shopfront_takedown_attempts"
            ? {
                id: 1,
                clone_alert_id: 10,
                attempt_type: "registrar_abuse",
                channel_autonomy: "human_required",
                case_status: "queued",
              }
            : {
                candidate_url: "https://evil.click/",
                candidate_domain: "evil.click",
                target_brand_normalized: null,
                attribution: { whois: { registrarAbuseEmail: "abuse@registrar.example" } },
              },
        error: null,
      }),
    );
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "statement timeout" } });
    const res = await adminEnforcementSend(
      new Request("http://x", { method: "POST", body: JSON.stringify({ caseId: 1, confirm: true }) }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "daily_cap_unavailable" });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
});

// ── the shared worker sends a clone subject ─────────────────────────────────
describe("runUrlBlocklistOnward — clone_alert subject", () => {
  const config = {
    intakeEmail: OPENPHISH_INTAKE_EMAIL,
    intakeName: "OpenPhish",
    featureEnabled: true,
    logFeature: "onward_openphish",
    logOperation: "openphish_url_forward",
  };
  const ctx = (data: Record<string, unknown>) =>
    ({
      event: { data },
      step: { run: (_id: string, f: () => unknown) => f() },
    }) as unknown as OnwardStepCtx;

  function withAlert(
    alert: Record<string, unknown> | null,
    claimed: unknown[] | null = [{ id: "log-1" }],
  ) {
    const updates: unknown[] = [];
    mocks.from.mockImplementation((table: string) => {
      // onward_report_log: the queued→sending claim returns the claimed row.
      const data =
        table === "shopfront_clone_alerts" ? alert : table === "onward_report_log" ? claimed : null;
      const chain = query({ data, error: null });
      chain.update = (patch: unknown) => {
        updates.push({ table, patch });
        return chain;
      };
      return chain;
    });
    return updates;
  }

  it("sends the query-stripped clone URL and marks the ledger row sent", async () => {
    const updates = withAlert({
      id: 10,
      candidate_url: "https://evil-commbank.click/login?email=v@x.com",
      candidate_domain: "evil-commbank.click",
      target_brand_normalized: "commbank",
      lifecycle_state: "weaponised",
    });
    const out = await runUrlBlocklistOnward(
      ctx({ log_id: "log-1", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(out).toMatchObject({ ok: true, providerMessageId: "msg-1" });
    const email = mocks.resendSend.mock.calls[0][0];
    expect(email.to).toEqual([OPENPHISH_INTAKE_EMAIL]);
    expect(email.text).toContain("https://evil-commbank.click/login");
    expect(email.text).not.toContain("v@x.com");
    expect(updates).toContainEqual({
      table: "onward_report_log",
      patch: expect.objectContaining({ status: "sent", provider_message_id: "msg-1" }),
    });
  });

  it("honours ONWARD_CANARY_RECIPIENT for a clone send too", async () => {
    vi.stubEnv("ONWARD_CANARY_RECIPIENT", "canary@askarthur.au");
    withAlert({
      id: 10,
      candidate_url: "https://evil.click/",
      candidate_domain: "evil.click",
      target_brand_normalized: null,
      lifecycle_state: "weaponised",
    });
    await runUrlBlocklistOnward(
      ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(mocks.resendSend.mock.calls[0][0].to).toEqual(["canary@askarthur.au"]);
  });

  it("re-verifies at send time: a lookalike no longer weaponised is skipped, not sent", async () => {
    const updates = withAlert({
      id: 10,
      candidate_url: "https://evil.click/",
      candidate_domain: "evil.click",
      target_brand_normalized: null,
      lifecycle_state: "taken_down",
    });
    const out = await runUrlBlocklistOnward(
      ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(out).toMatchObject({ ok: true, skipped: "clone_not_weaponised" });
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(updates).toContainEqual({
      table: "onward_report_log",
      patch: expect.objectContaining({ status: "skipped", status_reason: "clone_not_weaponised:taken_down" }),
    });
  });

  it("claims the ledger row queued→sending before sending, and sends nothing if another run holds it", async () => {
    const weaponised = {
      id: 10,
      candidate_url: "https://evil.click/",
      candidate_domain: "evil.click",
      target_brand_normalized: null,
      lifecycle_state: "weaponised",
    };
    let updates = withAlert(weaponised);
    await runUrlBlocklistOnward(
      ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(updates[0]).toEqual({ table: "onward_report_log", patch: { status: "sending" } });

    vi.clearAllMocks();
    updates = withAlert(weaponised, []); // already sending / sent: nothing claimed
    const out = await runUrlBlocklistOnward(
      ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(out).toMatchObject({ ok: true, skipped: "not_queued" });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("marks the row failed (not stuck 'sending') when the send step finally throws", async () => {
    const updates = withAlert({
      id: 10,
      candidate_url: "https://evil.click/",
      candidate_domain: "evil.click",
      target_brand_normalized: null,
      lifecycle_state: "weaponised",
    });
    mocks.resendSend.mockResolvedValue({ data: null, error: { message: "blocked" } });
    await expect(
      runUrlBlocklistOnward(
        ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
        config,
      ),
    ).rejects.toThrow("Resend rejected");
    expect(updates).toContainEqual({
      table: "onward_report_log",
      patch: expect.objectContaining({ status: "failed", status_reason: "send_failed" }),
    });
  });

  it("skips a clone alert that no longer exists (FP purge) instead of retrying forever", async () => {
    withAlert(null);
    const out = await runUrlBlocklistOnward(
      ctx({ log_id: "l", scam_report_id: null, clone_alert_id: 10, destination_key: OPENPHISH_INTAKE_EMAIL }),
      config,
    );
    expect(out).toMatchObject({ ok: true, skipped: "clone_alert_missing" });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
});

// ── the scam-report producer shares the per-URL dedup ───────────────────────
describe("report-onward-auto-report", () => {
  it("enqueues through enqueue_onward_url_reports with the primary URL, so a clone-reported URL is not re-sent", async () => {
    Object.assign(mocks.flags, { onwardAutoReport: true, onwardOpenphish: true });
    mocks.from.mockReturnValue(
      query({
        data: [{ id: 5, analysis_result: { scammerUrls: ["https://evil.click/a?x=1", "https://b.click"] } }],
        error: null,
      }),
    );
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const out = await invoke(onwardAutoReport);
    expect(mocks.rpc).toHaveBeenCalledWith("enqueue_onward_url_reports", {
      p_rows: [
        {
          source: "scam_report",
          scam_report_id: 5,
          destination: "openphish",
          destination_key: OPENPHISH_INTAKE_EMAIL,
          url: "https://evil.click/a?x=1",
        },
      ],
    });
    // Nothing new was inserted (conflict) → no event fired.
    expect(mocks.send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, enqueued: 0 });
  });
});

// ── enforcement-plan opens cases only for human-gated levers ────────────────
describe("casePlans", () => {
  it("drops the auto channels — their record is the onward ledger, not a case", () => {
    const plans = selectChannels({
      candidateUrl: "https://evil.click",
      candidateDomain: "evil.click",
      attribution: null,
    });
    expect(plans.some((p) => p.autonomy === "auto")).toBe(true);
    expect(casePlans(plans).map((p) => p.channel)).toEqual(["safe_browsing", "smartscreen"]);
  });
});

// ── stewardship counts clone-sourced sends ──────────────────────────────────
describe("brand stewardship over both sources", () => {
  it("counts a SENT clone row as reported for its brand, de-duped per clone alert", () => {
    const agg = aggregateOnwardByBrand(
      [
        { scam_report_id: 1, clone_alert_id: null, destination: "openphish", status: "sent" },
        { scam_report_id: null, clone_alert_id: 10, destination: "openphish", status: "sent" },
        { scam_report_id: null, clone_alert_id: 10, destination: "apwg", status: "sent" },
        { scam_report_id: null, clone_alert_id: 11, destination: "apwg", status: "queued" },
      ],
      new Map([[1, "CommBank"]]),
      new Map([
        [10, "CommBank"],
        [11, "CommBank"],
      ]),
    );
    const m = agg.get("CommBank")!;
    expect(m.reportsSent).toBe(3);
    expect(m.detected).toBe(2); // scam report 1 + clone alert 10
    expect(m.reportedByDestination).toEqual({ openphish: 2, apwg: 1 });
    expect(m.scamReportIds).toEqual([1]);
    expect(m.cloneAlertIds).toEqual([10]);
  });

  it("labels a clone alert with its known_brands name so the contact match is exact", () => {
    const names = new Map([["commbank.com.au", "CommBank"]]);
    expect(
      cloneBrandLabel({ inferred_target_domain: "commbank.com.au", target_brand_normalized: "commbank" }, names),
    ).toBe("CommBank");
    expect(
      cloneBrandLabel({ inferred_target_domain: "unknown.com.au", target_brand_normalized: "anz" }, names),
    ).toBe("anz");
    expect(cloneBrandLabel({ inferred_target_domain: null, target_brand_normalized: null }, names)).toBeNull();
  });
});
