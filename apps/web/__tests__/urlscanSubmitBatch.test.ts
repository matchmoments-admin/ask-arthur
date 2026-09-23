import { describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/scam-engine/urlscan", () => ({ submitURLScanWithDetails: vi.fn() }));
vi.mock("@askarthur/scam-engine", () => ({ checkURLReputation: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: () => null }));

import {
  submitCandidateBatch,
  type SubmitOutcome,
} from "@/lib/clone-watch/urlscan-submit-one";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    candidate_url: `https://c${i + 1}.example`,
    candidate_domain: `c${i + 1}.example`,
  }));
const open = { expired: () => false };
const out = (kind: SubmitOutcome["kind"], reputationMalicious = false): SubmitOutcome => ({
  kind,
  reputationMalicious,
});

// The ONE outcome → counter mapping for the submit and recheck lanes.
describe("submitCandidateBatch", () => {
  it("maps every outcome kind to exactly one counter", async () => {
    const kinds: SubmitOutcome[] = [
      out("submitted"),
      out("reputation_classified", true),
      out("rate_limited"),
      out("dns_no_host"),
      out("submit_failed"),
      out("no_client"),
    ];
    const submitOne = vi.fn(async () => kinds.shift()!);
    const t = await submitCandidateBatch(rows(6), open, { submitOne });
    expect(t).toEqual({
      submitted: 2,
      rateLimited: 1,
      dnsSkipped: 1,
      submitFailed: 2,
      reputationHits: 1,
      attemptedIds: [1, 2, 4, 5, 6], // every row looked at EXCEPT the 429
      unreached: 0,
    });
  });

  it("a 429 is quota, never a failure", async () => {
    const t = await submitCandidateBatch(rows(3), open, {
      submitOne: async () => out("rate_limited"),
    });
    expect(t.submitFailed).toBe(0);
    expect(t.rateLimited).toBe(3);
    expect(t.attemptedIds).toEqual([]);
  });

  it("a thrown row counts as failed and attempted, and the loop continues", async () => {
    const onRowError = vi.fn();
    const submitOne = vi
      .fn()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(out("submitted"));
    const t = await submitCandidateBatch(rows(2), open, { submitOne, onRowError });
    expect(t).toMatchObject({ submitted: 1, submitFailed: 1, attemptedIds: [1, 2] });
    expect(onRowError).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("stops at the budget and reports the rows it never reached", async () => {
    let calls = 0;
    const budget = { expired: () => calls >= 2 };
    const t = await submitCandidateBatch(rows(5), budget, {
      submitOne: async () => {
        calls++;
        return out("submitted");
      },
    });
    expect(t.submitted).toBe(2);
    expect(t.unreached).toBe(3);
    expect(t.attemptedIds).toEqual([1, 2]);
  });
});
