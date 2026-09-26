import { describe, expect, it } from "vitest";

/**
 * #1253 — the WHOIS re-offer's decisions. Every re-offered row must leave the
 * `attribution_retry_after <= now()` predicate (the worklist-gate starvation
 * rule), a deferral must never destroy data, and a domain whoisjson keeps
 * refusing must stop costing a lookup a day.
 *
 * Go-red record (2026-09-27, each reverted → failed → restored):
 *   - abandonment removed (the `>= WHOIS_HTTP_ERROR_MAX_DEFERRALS` branch):
 *     "gives up after repeated http errors" fails (redeferred, retry set).
 *   - a thrown lookup left unhandled in runWhoisReoffer (no try/catch):
 *     "moves every row across the predicate" fails (row counted as a lookup
 *     failure, nothing written — the row would pin the head).
 *   - redeferral built from the fresh (empty) block instead of `prev`: "keeps
 *     the previous block's data" fails (createdDate lost).
 *   - campaign key computed on every verdict: "only a resolved re-offer
 *     touches campaign_key" fails.
 *   - whoisRetryAfter returning retryAfter regardless of source: "a
 *     non-deferred dossier stamps nothing" fails.
 */

import type { DomainRegistration } from "@askarthur/scam-engine/domain-registration";
import {
  WHOIS_HTTP_ERROR_MAX_DEFERRALS,
  planWhoisReoffer,
  runWhoisReoffer,
  type ReofferRow,
  type ReofferWrite,
  type WhoisBlock,
} from "@/lib/clone-watch/whois-reoffer";
import {
  shapeWhoisSection,
  whoisRetryAfter,
} from "@/lib/clone-watch/enrich-attribution";

const NOW = new Date("2026-10-01T13:30:00Z");

const reg = (over: Partial<DomainRegistration> = {}): DomainRegistration => ({
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
  statuses: [],
  registrarIanaId: null,
  abuseContact: null,
  source: "whoisjson",
  ...over,
});

const deferredReg = (
  reason: "quota_deferred" | "http_error" | "not_configured",
  retryAfter = "2026-11-01T00:00:00.000Z",
) => reg({ source: "deferred", deferralReason: reason, retryAfter });

const PREV: WhoisBlock = {
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: "2026-08-30",
  nameServers: ["ns1.example"],
  statuses: [],
  registrarIanaId: null,
  source: "whoisjson",
};

describe("planWhoisReoffer", () => {
  it("an answer clears the mark and replaces the block", () => {
    const p = planWhoisReoffer(
      PREV,
      reg({ registrar: "GoDaddy", source: "rdap" }),
      NOW,
    );
    expect(p.verdict).toBe("resolved");
    expect(p.retryAfter).toBeNull();
    expect(p.whois.registrar).toBe("GoDaddy");
    expect(p.whois.source).toBe("rdap");
    expect(p.whois).not.toHaveProperty("retryAfter");
  });

  it("a served answer with no registrar is still an answer — final", () => {
    const p = planWhoisReoffer(PREV, reg(), NOW);
    expect(p.verdict).toBe("resolved");
    expect(p.retryAfter).toBeNull();
  });

  it("deferred again pushes the mark forward and keeps the previous block's data", () => {
    const p = planWhoisReoffer(PREV, deferredReg("quota_deferred"), NOW);
    expect(p.verdict).toBe("redeferred");
    expect(p.retryAfter).toBe("2026-11-01T00:00:00.000Z");
    expect(p.whois.createdDate).toBe("2026-08-30");
    expect(p.whois.nameServers).toEqual(["ns1.example"]);
    expect(p.whois.source).toBe("deferred");
    expect(p.whois.retryAfter).toBe("2026-11-01T00:00:00.000Z");
    // A quota deferral is not a refusal — it does not count toward giving up.
    expect(p.whois.httpErrorDeferrals).toBeUndefined();
  });

  it("gives up after repeated http errors (the mark is cleared)", () => {
    let prev: WhoisBlock | null = PREV;
    const verdicts: string[] = [];
    for (let i = 0; i < WHOIS_HTTP_ERROR_MAX_DEFERRALS; i++) {
      const p = planWhoisReoffer(prev, deferredReg("http_error"), NOW);
      verdicts.push(p.verdict);
      prev = p.whois;
      if (p.verdict === "abandoned") {
        expect(p.retryAfter).toBeNull();
        expect(p.whois.source).toBe("deferred");
        expect(p.whois).not.toHaveProperty("retryAfter");
      }
    }
    expect(verdicts).toEqual([
      ...Array(WHOIS_HTTP_ERROR_MAX_DEFERRALS - 1).fill("redeferred"),
      "abandoned",
    ]);
    expect(prev?.httpErrorDeferrals).toBe(WHOIS_HTTP_ERROR_MAX_DEFERRALS);
  });

  // #1259 review. Go-red (2026-09-27): make `isStrike` true for every
  // http_error regardless of status → "a vendor 429 is never a strike" fails
  // when a 429 arrives labelled http_error (the belt-and-braces path).
  it("a vendor 429 is never a strike — a row cannot be abandoned by quota", () => {
    let prev: WhoisBlock | null = PREV;
    for (let i = 0; i < WHOIS_HTTP_ERROR_MAX_DEFERRALS + 2; i++) {
      for (const r of [
        reg({
          source: "deferred",
          deferralReason: "quota_deferred",
          deferralStatus: 429,
          retryAfter: "2026-11-01T00:00:00.000Z",
        }),
        // Even mislabelled as http_error, a 429 status is not a strike.
        reg({
          source: "deferred",
          deferralReason: "http_error",
          deferralStatus: 429,
          retryAfter: "2026-10-02T13:30:00.000Z",
        }),
      ]) {
        const p = planWhoisReoffer(prev, r, NOW);
        expect(p.verdict).toBe("redeferred");
        expect(p.whois.deferralStatus).toBe(429);
        prev = p.whois;
      }
    }
    expect(prev?.httpErrorDeferrals).toBeUndefined();
  });

  it("not_configured is never a strike either", () => {
    let prev: WhoisBlock | null = PREV;
    for (let i = 0; i < WHOIS_HTTP_ERROR_MAX_DEFERRALS + 1; i++) {
      const p = planWhoisReoffer(prev, deferredReg("not_configured"), NOW);
      expect(p.verdict).toBe("redeferred");
      prev = p.whois;
    }
  });

  it("a thrown lookup (null) is an http_error deferral 24h out", () => {
    const p = planWhoisReoffer(null, null, NOW);
    expect(p.verdict).toBe("redeferred");
    expect(p.retryAfter).toBe("2026-10-02T13:30:00.000Z");
    expect(p.whois.httpErrorDeferrals).toBe(1);
    expect(p.whois.source).toBe("deferred");
  });
});

describe("shapeWhoisSection / whoisRetryAfter", () => {
  it("a deferred lookup carries retryAfter into the dossier and the column", () => {
    const w = shapeWhoisSection(deferredReg("quota_deferred"));
    expect(w).toMatchObject({
      source: "deferred",
      retryAfter: "2026-11-01T00:00:00.000Z",
      deferralReason: "quota_deferred",
    });
    expect(whoisRetryAfter({ whois: w })).toBe("2026-11-01T00:00:00.000Z");
  });

  it("a non-deferred dossier stamps nothing", () => {
    expect(whoisRetryAfter({ whois: shapeWhoisSection(reg()) })).toBeNull();
    expect(
      whoisRetryAfter({
        whois: { ...PREV, retryAfter: "2026-11-01T00:00:00.000Z" },
      }),
    ).toBeNull();
    expect(whoisRetryAfter({ whois: null })).toBeNull();
  });
});

describe("runWhoisReoffer", () => {
  const rows = (n: number): ReofferRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      candidate_domain: `d${i + 1}.example`,
      attribution: {
        whois: PREV,
        kit_siblings: { siblings: [] },
      } as unknown as ReofferRow["attribution"],
    }));
  const neverExpires = { expired: () => false };

  it("moves every row across the predicate: resolved, re-deferred, or thrown", async () => {
    const writes: ReofferWrite[] = [];
    const out = await runWhoisReoffer({
      rows: rows(3),
      budget: neverExpires,
      minStartIntervalMs: 0,
      lookup: async (d) => {
        if (d === "d1.example") return reg({ registrar: "R", source: "rdap" });
        if (d === "d2.example") return deferredReg("quota_deferred");
        throw new Error("boom");
      },
      flush: async (w) => {
        writes.push(...w);
        return { written: w.length };
      },
      now: () => NOW,
    });
    expect(out).toMatchObject({
      due: 3,
      reoffered: 3,
      written: 3,
      resolved: 1,
      redeferred: 2,
      abandoned: 0,
    });
    const byId = new Map(writes.map((w) => [w.id, w]));
    expect(byId.get(1)?.retry_after).toBeNull();
    expect(byId.get(2)?.retry_after).toBe("2026-11-01T00:00:00.000Z");
    // "a lookup that throws still moves the row": written, pushed 24h.
    expect(byId.get(3)?.retry_after).toBe("2026-10-02T13:30:00.000Z");
  });

  it("only a resolved re-offer touches campaign_key, from the merged dossier", async () => {
    const seen: Record<string, unknown>[] = [];
    const writes: ReofferWrite[] = [];
    await runWhoisReoffer({
      rows: rows(2),
      budget: neverExpires,
      minStartIntervalMs: 0,
      lookup: async (d) =>
        d === "d1.example"
          ? reg({ registrar: "R", source: "rdap" })
          : deferredReg("quota_deferred"),
      flush: async (w) => {
        writes.push(...w);
        return { written: w.length };
      },
      campaignKey: (dossier) => {
        seen.push(dossier);
        return "key-1";
      },
      now: () => NOW,
    });
    const byId = new Map(writes.map((w) => [w.id, w]));
    expect(byId.get(1)?.campaign_key).toBe("key-1");
    expect(byId.get(2)?.campaign_key).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty("kit_siblings");
    expect((seen[0]!.whois as WhoisBlock).registrar).toBe("R");
  });

  it("paces lookups at the enrich batch's start interval", async () => {
    let t = 0;
    const starts: number[] = [];
    await runWhoisReoffer({
      rows: rows(4),
      budget: neverExpires,
      minStartIntervalMs: 3_000,
      concurrency: 4,
      clock: () => t,
      // Fake timer as in enrichAttributionBatch.test.ts: wakes at the
      // caller's target time, so the shared clock only moves forward.
      sleep: (ms) => {
        const target = t + ms;
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            t = Math.max(t, target);
            resolve();
          }, 0),
        );
      },
      lookup: async () => {
        starts.push(t);
        await Promise.resolve();
        return reg();
      },
      flush: async (w) => ({ written: w.length }),
      now: () => NOW,
    });
    const sorted = [...starts].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(3_000);
    }
  });

  it("a failed chunk write is counted, and those rows stay due", async () => {
    const out = await runWhoisReoffer({
      rows: rows(2),
      budget: neverExpires,
      minStartIntervalMs: 0,
      lookup: async () => reg(),
      flush: async () => ({ error: "boom" }),
      now: () => NOW,
    });
    expect(out).toMatchObject({ reoffered: 2, written: 0, writeFailed: 2 });
  });
});
