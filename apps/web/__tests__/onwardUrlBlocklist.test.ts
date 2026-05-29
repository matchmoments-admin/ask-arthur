import { describe, expect, it, vi } from "vitest";
import {
  runUrlBlocklistOnward,
  stripUrlPii,
  type OnwardStepCtx,
} from "@/lib/onward/url-blocklist-report";

describe("stripUrlPii", () => {
  it("drops the query string (which can carry victim PII)", () => {
    expect(stripUrlPii("https://evil.test/login?email=victim@x.com&abn=123")).toBe(
      "https://evil.test/login",
    );
  });

  it("drops the fragment but keeps scheme/host/path", () => {
    expect(stripUrlPii("http://evil.test/a/b#token=abc")).toBe(
      "http://evil.test/a/b",
    );
  });

  it("leaves a clean URL untouched (minus trailing slash semantics)", () => {
    expect(stripUrlPii("https://evil.test/phish")).toBe("https://evil.test/phish");
  });

  it("falls back to a manual split for an unparseable URL (never forwards query whole)", () => {
    expect(stripUrlPii("not a url?email=victim@x.com")).toBe("not a url");
  });
});

// The runner short-circuits on a disabled flag BEFORE any Supabase/Resend
// I/O, so the disabled path needs no mocks. This is the no-regression guard:
// a destination whose flag is OFF must never attempt a send.
describe("runUrlBlocklistOnward", () => {
  function makeCtx() {
    const runIds: string[] = [];
    return {
      runIds,
      ctx: {
        event: {
          data: {
            log_id: "00000000-0000-0000-0000-000000000000",
            scam_report_id: 123,
            destination_key: "report@openphish.com",
          },
        },
        step: {
          run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
            runIds.push(id);
            return fn();
          }),
        },
      },
    };
  }

  it("no-ops with skipped=flag_disabled when the feature flag is OFF", async () => {
    const { ctx, runIds } = makeCtx();
    const result = await runUrlBlocklistOnward(ctx as unknown as OnwardStepCtx, {
      intakeEmail: "report@openphish.com",
      intakeName: "OpenPhish",
      featureEnabled: false,
      logFeature: "onward_openphish",
      logOperation: "openphish_url_forward",
    });

    expect(result).toEqual({ ok: true, skipped: "flag_disabled" });
    // Crucially: it must NOT have run the load-report or send-email steps.
    expect(runIds).not.toContain("send-email");
    expect(runIds).not.toContain("load-report");
  });
});
