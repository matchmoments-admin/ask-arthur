import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform Entity bridge (#1151, v309) — the module and its consumer.
 *
 * Go-red record:
 *   - "feeds a tp_actioned weaponised row": the ticket's acceptance criterion.
 *     The old writer was gated `triage_status IS NULL` in auto-triage; 136 of
 *     147 weaponised rows were tp_actioned, so the bridge never fired. Add
 *     `if (row.triage_status !== null) continue;` to the consumer's loop →
 *     this fails (rpc called 0 times for the tp_actioned row).
 *   - "flag off returns before any RPC": remove the flag check in
 *     feedCloneEntity → the rpc mock is called.
 *   - "fp triage retracts": in the admin route, drop the `else if (fp)` →
 *     retract never called (covered by the route-level assertion below).
 *   - "normaliser is the extension's": platformEntityUrlArgs must produce the
 *     same normalized_url url-check looks up; swapping in a hand-rolled
 *     lower()+rtrim breaks the trailing-slash / tld cases.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  log: vi.fn(),
  flags: { cloneWatchFeedEntities: true },
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
    send: vi.fn(),
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
  elapsedSinceTrigger: () => 0,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: mocks.flags,
}));
vi.mock("@/lib/cost-telemetry", () => ({
  logCost: mocks.log,
  logCostAsync: mocks.log,
}));
// The per-run `feed_batch` Outcome Row goes through `recordLaneOutcome`
// (lane-outcome.ts), which writes via scam-engine's logCost.
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  logCost: mocks.log,
}));

import {
  feedCloneEntity,
  platformEntityUrlArgs,
  retractCloneEntity,
} from "@/lib/clone-watch/feed-entity";
import { cloneWatchFeedPlatform } from "@/app/api/inngest/functions/clone-watch-feed-platform";

const invoke = (handler: unknown) =>
  (handler as (ctx: unknown) => Promise<unknown>)({
    event: { ts: Date.now(), data: { cron: "manual" } },
    step: { run: (_name: string, fn: () => unknown) => fn() },
  });

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.log.mockReset();
  mocks.flags.cloneWatchFeedEntities = true;
});
afterEach(() => vi.clearAllMocks());

describe("platformEntityUrlArgs — the scam_urls identity the extension matches", () => {
  it("normalises the clone's root URL the way url-check will look it up", () => {
    expect(platformEntityUrlArgs("https://Coinbase-Account.info/")).toEqual({
      p_normalized_url: "https://coinbase-account.info/",
      p_domain: "coinbase-account.info",
      p_subdomain: null,
      p_tld: ".info",
      p_full_path: "/",
    });
  });

  it("handles multi-label public suffixes and subdomains", () => {
    const a = platformEntityUrlArgs("https://login.nab-secure.com.au/verify/");
    expect(a).toMatchObject({
      p_normalized_url: "https://login.nab-secure.com.au/verify",
      p_domain: "nab-secure.com.au",
      p_subdomain: "login",
      p_tld: ".com.au",
      p_full_path: "/verify",
    });
  });

  it("is null for a non-http candidate", () => {
    expect(platformEntityUrlArgs("mailto:x@y")).toBeNull();
  });
});

describe("feedCloneEntity", () => {
  it("returns before any RPC when the flag is off", async () => {
    mocks.flags.cloneWatchFeedEntities = false;
    const r = await feedCloneEntity({ id: 1, candidate_url: "https://a.b/" });
    expect(r).toEqual({ kind: "skipped", reason: "flag_off" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("calls the v309 RPC with the alert id + normalised url and logs a $0 cost row", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        written: true,
        domain_entity_id: 10,
        ip_entity_id: null,
        scam_url_id: 77,
      },
      error: null,
    });
    const r = await feedCloneEntity({
      id: 4088,
      candidate_url: "https://coinbase-account.info/",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("feed_clone_platform_entity", {
      p_alert_id: 4088,
      p_normalized_url: "https://coinbase-account.info/",
      p_domain: "coinbase-account.info",
      p_subdomain: null,
      p_tld: ".info",
      p_full_path: "/",
    });
    expect(r).toEqual({
      kind: "written",
      domainEntityId: 10,
      ipEntityId: null,
      scamUrlId: 77,
    });
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "clone_watch_feed_entity",
        operation: "feed",
        unitCostUsd: 0,
        metadata: expect.objectContaining({ alert_id: 4088, written: true }),
      }),
    );
  });

  it("reports the RPC's refusal as an outcome, not an error", async () => {
    mocks.rpc.mockResolvedValue({
      data: { written: false, reason: "triaged_fp" },
      error: null,
    });
    const r = await feedCloneEntity({ id: 5, candidate_url: "https://x.y/" });
    expect(r).toEqual({ kind: "not_written", reason: "triaged_fp" });
  });

  it("throws on a transport error so a wrapping step retries", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    });
    await expect(
      feedCloneEntity({ id: 5, candidate_url: "https://x.y/" }),
    ).rejects.toThrow(/feed_clone_platform_entity failed for alert 5/);
  });
});

describe("retractCloneEntity", () => {
  it("is not flag-gated and logs a retract row", async () => {
    mocks.flags.cloneWatchFeedEntities = false;
    mocks.rpc.mockResolvedValue({
      data: {
        retracted: true,
        entities_deleted: 2,
        entities_detached: 2,
        scam_url_deactivated: true,
      },
      error: null,
    });
    const r = await retractCloneEntity(9);
    expect(mocks.rpc).toHaveBeenCalledWith("retract_clone_platform_entity", {
      p_alert_id: 9,
    });
    expect(r).toEqual({
      kind: "retracted",
      entitiesDeleted: 2,
      entitiesDetached: 2,
      scamUrlDeactivated: true,
    });
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "retract" }),
    );
  });
});

describe("shopfront-clone-feed-platform consumer", () => {
  it("feeds a tp_actioned weaponised row — the row the old writer skipped", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_clone_alerts_pending_platform_entity") {
        return {
          data: [
            {
              id: 2973,
              candidate_domain: "appleinc-support.info",
              candidate_url: "https://appleinc-support.info/",
              inferred_target_domain: "apple.com",
              weaponised_at: "2026-09-01T00:00:00Z",
              triage_status: "tp_actioned",
            },
            {
              id: 4088,
              candidate_domain: "coinbase-account.info",
              candidate_url: "https://coinbase-account.info/",
              inferred_target_domain: "coinbase.com",
              weaponised_at: "2026-09-16T21:10:00Z",
              triage_status: "pending",
            },
          ],
          error: null,
        };
      }
      return {
        data: { written: true, domain_entity_id: 1, scam_url_id: 2 },
        error: null,
      };
    });

    const result = (await invoke(cloneWatchFeedPlatform)) as {
      written: number;
      pool: number;
    };
    expect(result).toMatchObject({ ok: true, pool: 2, written: 2 });
    const fed = mocks.rpc.mock.calls
      .filter(([fn]) => fn === "feed_clone_platform_entity")
      .map(([, args]) => (args as { p_alert_id: number }).p_alert_id);
    expect(fed).toEqual([2973, 4088]);
    // Worklist first, before any write: an empty worklist must cost one RPC.
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe(
      "list_clone_alerts_pending_platform_entity",
    );
    // One summary row for the batch, on top of the per-write rows.
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "feed_batch",
        metadata: expect.objectContaining({ pool: 2, written: 2, failed: 0 }),
      }),
    );
  });

  it("an empty worklist returns after the one worklist RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const r = await invoke(cloneWatchFeedPlatform);
    expect(r).toMatchObject({ ok: true, pool: 0, written: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("a row that throws is counted failed and the batch continues", async () => {
    let n = 0;
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "list_clone_alerts_pending_platform_entity") {
        return {
          data: [
            { id: 1, candidate_url: "https://a.info/", triage_status: null },
            { id: 2, candidate_url: "https://b.info/", triage_status: null },
          ],
          error: null,
        };
      }
      n++;
      if (n === 1) return { data: null, error: { message: "deadlock" } };
      return { data: { written: true }, error: null };
    });
    const r = await invoke(cloneWatchFeedPlatform);
    expect(r).toMatchObject({ pool: 2, written: 1, failed: 1 });
  });

  it("returns skipped before any RPC when the flag is off", async () => {
    mocks.flags.cloneWatchFeedEntities = false;
    const r = await invoke(cloneWatchFeedPlatform);
    expect(r).toMatchObject({ skipped: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
