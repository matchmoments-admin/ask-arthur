/**
 * Fail-soft paths must be observable, and must not read as health.
 *
 * CLAUDE.md:211 requires every feature to be observable — Axiom logs, with
 * rare high-value events on always-ship `warn` rather than the 10%-sampled
 * `info`. Two paths shipped this session without it, and one of them was a
 * behaviour bug rather than only a missing log:
 *
 *   1. `resolveBadgeSubject` returned "unscanned" when the LOOKUP FAILED. That
 *      is a claim about the domain ("Not yet scanned") standing in for a fact
 *      about us ("we could not check"). A schema change, an RLS change or an
 *      outage would have turned every badge on the site neutral while looking
 *      exactly like ordinary traffic.
 *
 *   2. `toCanonicalScamType` returns null for an unmapped label — correct, and
 *      silent. A new value arriving from free-text `scam_type` would simply
 *      stop appearing in every count, and a chart getting quietly smaller is
 *      not a signal anyone reads.
 *
 * Both are the same shape: degradation that presents as a normal, smaller,
 * plausible answer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const warn = vi.fn();
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn, error: vi.fn() },
}));

let queryResult: { data: unknown; error: unknown } = { data: null, error: null };
let clientAvailable = true;

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () =>
    clientAvailable
      ? {
          from: () => ({
            select: () => ({
              eq: () => ({ single: async () => queryResult }),
            }),
          }),
        }
      : null,
}));

const { resolveBadgeSubject } = await import("@/lib/badge/eligibility");
const { computeScamTypeMovement } = await import("@/lib/scam-type-trend");

describe("badge lookup distinguishes 'not scanned' from 'could not check'", () => {
  beforeEach(() => {
    warn.mockClear();
    clientAvailable = true;
    queryResult = { data: null, error: null };
  });

  it("returns unavailable — not unscanned — when the query fails", () => {
    // THE behaviour fix. Both used to return "unscanned", so an outage
    // rendered a claim about every domain on the site.
    queryResult = { data: null, error: { code: "42P01", message: "relation missing" } };
    return resolveBadgeSubject("example.com").then((s) => {
      expect(s.kind).toBe("unavailable");
    });
  });

  it("still returns unscanned for a genuine no-rows result", async () => {
    // PGRST116 is a real answer: the domain is not in `sites`. Treating it as
    // an outage would be the opposite mistake.
    queryResult = { data: null, error: { code: "PGRST116", message: "no rows" } };
    expect((await resolveBadgeSubject("example.com")).kind).toBe("unscanned");
  });

  it("logs a failed lookup at warn, which bypasses sampling", async () => {
    queryResult = { data: null, error: { code: "42P01", message: "relation missing" } };
    await resolveBadgeSubject("example.com");
    expect(warn).toHaveBeenCalledWith(
      "badge_subject_lookup_failed",
      expect.objectContaining({ domain: "example.com", code: "42P01" }),
    );
  });

  it("logs a missing service client at warn", async () => {
    clientAvailable = false;
    const s = await resolveBadgeSubject("example.com");
    expect(s.kind).toBe("unavailable");
    expect(warn).toHaveBeenCalledWith(
      "badge_subject_unavailable",
      expect.objectContaining({ reason: "no_service_client" }),
    );
  });

  it("does not log on the ordinary paths", async () => {
    // A warn on every unscanned domain would be noise, and noise is how a real
    // signal gets ignored.
    queryResult = {
      data: { latest_grade: "A", latest_score: 91, last_scanned_at: "2026-08-01" },
      error: null,
    };
    await resolveBadgeSubject("good.example");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("an unmapped scam-type label does not vanish silently", () => {
  const at = new Date().toISOString();

  it("counts a label the taxonomy has never heard of", () => {
    const unmapped: Record<string, number> = {};
    computeScamTypeMovement(
      [
        { rawType: "phishing", at },
        { rawType: "crypto_drainer", at },
        { rawType: "crypto_drainer", at },
      ],
      new Date(),
      28,
      unmapped,
    );
    expect(unmapped).toEqual({ crypto_drainer: 2 });
  });

  it("does not report the deliberate nulls as drift", () => {
    // `informational` and `none` are judgements that a post is not a scam.
    // Reporting them would bury a real unmapped label in routine noise.
    const unmapped: Record<string, number> = {};
    computeScamTypeMovement(
      [
        { rawType: "informational", at },
        { rawType: "none", at },
      ],
      new Date(),
      28,
      unmapped,
    );
    expect(unmapped).toEqual({});
  });
});
