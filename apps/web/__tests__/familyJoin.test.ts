import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: { id: "u1", email: "Invitee@Example.com" } as { id: string; email: string } | null,
  member: null as null | Record<string, unknown>,
  updated: [{ id: 5 }] as { id: number }[] | null,
  rate: { allowed: true, remaining: 1, resetAt: null } as Record<string, unknown>,
  updateCalls: [] as unknown[],
  guards: [] as string[],
}));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: { familyPlan: true } }));
vi.mock("@askarthur/utils/rate-limit", () => ({ checkFormRateLimit: async () => m.rate }));
vi.mock("@askarthur/supabase/server-auth", () => ({ createAuthServerClient: async () => ({}) }));
vi.mock("@/lib/auth", () => ({
  AuthUnavailableError: class extends Error {},
  getSupabaseUserOrThrow: async () => m.user,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "family_activity_log") return { insert: async () => ({ error: null }) };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = (col: string) => {
        m.guards.push(col);
        return chain;
      };
      chain.maybeSingle = async () => ({ data: m.member, error: null });
      chain.update = (u: unknown) => {
        m.updateCalls.push(u);
        const upd: Record<string, unknown> = {};
        upd.eq = () => upd;
        upd.is = (col: string) => {
          m.guards.push(`update:${col}`);
          return upd;
        };
        upd.select = async () => ({ data: m.updated, error: null });
        return upd;
      };
      return chain;
    },
  }),
}));

import { POST } from "@/app/api/family/join/route";

const CODE = "A".repeat(22);
const join = (body: unknown) =>
  POST(new Request("https://x.test/api/family/join", { method: "POST", body: JSON.stringify(body) }) as never);
const future = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  m.user = { id: "u1", email: "Invitee@Example.com" };
  m.member = { id: 5, group_id: "g1", email: "invitee@example.com", expires_at: future() };
  m.updated = [{ id: 5 }];
  m.rate = { allowed: true, remaining: 1, resetAt: null };
  m.updateCalls = [];
  m.guards = [];
});

describe("POST /api/family/join", () => {
  it("joins with a valid, unexpired code addressed to the caller (email case-insensitive)", async () => {
    const res = await join({ inviteCode: CODE });
    expect(res.status).toBe(200);
    // Redemption is guarded on joined_at IS NULL at update time (atomic).
    expect(m.guards).toContain("update:joined_at");
  });

  it("rejects an expired code", async () => {
    m.member = { ...m.member, expires_at: new Date(Date.now() - 1000).toISOString() };
    expect((await join({ inviteCode: CODE })).status).toBe(404);
    expect(m.updateCalls).toHaveLength(0);
  });

  it("rejects an invite with no expiry recorded", async () => {
    m.member = { ...m.member, expires_at: null };
    expect((await join({ inviteCode: CODE })).status).toBe(404);
  });

  it("rejects a code addressed to a different email", async () => {
    m.member = { ...m.member, email: "someone.else@example.com" };
    expect((await join({ inviteCode: CODE })).status).toBe(404);
    expect(m.updateCalls).toHaveLength(0);
  });

  it("loses a concurrent redemption race cleanly (0 rows updated → 404)", async () => {
    m.updated = [];
    expect((await join({ inviteCode: CODE })).status).toBe(404);
  });

  it("validates the body (short or missing code → 400)", async () => {
    expect((await join({ inviteCode: "ABCD1234" })).status).toBe(400);
    expect((await join({})).status).toBe(400);
  });

  it("is rate-limited per user (429) and fails closed when the store is down (503)", async () => {
    m.rate = { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 30_000), reason: "exceeded" };
    expect((await join({ inviteCode: CODE })).status).toBe(429);
    m.rate = { allowed: false, remaining: 0, resetAt: null, reason: "store_unavailable" };
    expect((await join({ inviteCode: CODE })).status).toBe(503);
  });
});
