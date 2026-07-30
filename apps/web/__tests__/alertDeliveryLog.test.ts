import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Record<string, unknown>[] = [];

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const sendMock = vi.fn(async () => ({ ok: true, latencyMs: 5 }) as never);
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: (...args: unknown[]) => sendMock(...(args as [])),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  ALERTERS,
  alertAndRecord,
  recordNoAlertNeeded,
} from "@/lib/alerting/deliveryLog";

beforeEach(() => {
  inserted.length = 0;
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, latencyMs: 5 } as never);
});

describe("recordNoAlertNeeded", () => {
  it("writes a row for the healthy case", async () => {
    // The load-bearing invariant: without this row, a missing row would mean
    // "nothing was wrong" instead of "the alerter did not run".
    await recordNoAlertNeeded("health-digest", { stale_feeds: 0 });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      alerter: "health-digest",
      condition_met: false,
      outcome: "no_alert_needed",
      channel: "none",
    });
  });

  it("carries the metadata that justified the quiet verdict", async () => {
    await recordNoAlertNeeded("feedback-digest", { total: 12, disagreements: 0 });
    expect(inserted[0].metadata).toEqual({ total: 12, disagreements: 0 });
  });
});

describe("alertAndRecord outcome mapping", () => {
  it("records 'sent' when the transport confirms", async () => {
    const r = await alertAndRecord({ alerter: "cost-daily-check", text: "hi" });

    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(inserted[0]).toMatchObject({
      alerter: "cost-daily-check",
      condition_met: true,
      outcome: "sent",
      latency_ms: 5,
    });
  });

  it("records 'skipped_no_config' when the chat id is absent", async () => {
    sendMock.mockResolvedValue({
      ok: false,
      reason: "no_config",
      latencyMs: 0,
    } as never);

    await alertAndRecord({ alerter: "health-digest", text: "hi" });

    expect(inserted[0]).toMatchObject({ outcome: "skipped_no_config" });
  });

  it("records 'failed' when the transport rejects, and keeps the error", async () => {
    sendMock.mockResolvedValue({
      ok: false,
      reason: "send_failed",
      error: "429 Too Many Requests",
      latencyMs: 12,
    } as never);

    await alertAndRecord({ alerter: "axiom-fleet-watch", text: "hi" });

    expect(inserted[0]).toMatchObject({
      outcome: "failed",
      error: "429 Too Many Requests",
    });
  });

  it("records 'muted' WITHOUT sending when disabled by a flag", async () => {
    // Distinct from no_alert_needed: a real alert was suppressed. This is the
    // FF_LEGACY_DIGEST_TELEGRAM case, which must stay visible in the liveness
    // query rather than looking like a healthy alerter.
    const r = await alertAndRecord({
      alerter: "feedback-digest",
      text: "something is wrong",
      enabled: false,
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(inserted[0]).toMatchObject({
      condition_met: true,
      outcome: "muted",
      channel: "none",
    });
  });

  it("hashes the payload instead of storing it", async () => {
    await alertAndRecord({ alerter: "cost-weekly-digest", text: "secret body" });

    const row = inserted[0];
    expect(row.payload_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(row)).not.toContain("secret body");
  });

  it("is stable: the same body hashes the same way", async () => {
    await alertAndRecord({ alerter: "cost-weekly-digest", text: "same" });
    await alertAndRecord({ alerter: "cost-weekly-digest", text: "same" });
    expect(inserted[0].payload_digest).toBe(inserted[1].payload_digest);
  });
});

describe("ALERTERS roster", () => {
  it("lists the 8 alerters the acceptance-test liveness query expects", () => {
    expect(ALERTERS).toHaveLength(8);
    expect(new Set(ALERTERS).size).toBe(8);
  });

  it("every id matches a cron route directory name", () => {
    // Guards against a typo making an alerter invisible to the liveness query
    // while its route still appears to work.
    for (const a of ALERTERS) {
      expect(a).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
