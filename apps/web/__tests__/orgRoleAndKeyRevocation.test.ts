import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Server-owned account state (v322 follow-up to v321): key revocation goes
// through the service role with an explicit ownership check; only the owner
// grants admin; only assignable roles are accepted from an invitation; account
// deletion revokes the user's API keys before the auth user is removed.

const m = vi.hoisted(() => ({
  user: { id: "u1", email: "me@example.com" } as { id: string; email?: string } | null,
  org: null as null | { orgId: string; memberRole: string; orgName?: string },
  key: null as null | { id: number; user_id: string | null; org_id: string | null },
  invitation: null as null | Record<string, unknown>,
  keyUpdate: vi.fn(),
  keyUpdateError: null as null | { message: string },
  memberInsert: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUser: async () => m.user,
  AuthUnavailableError: class extends Error {},
  getSupabaseUserOrThrow: async () => m.user,
}));
vi.mock("@/lib/org", () => ({ getOrg: async () => m.org }));
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkOrgInviteSendRateLimit: async () => ({ allowed: true }),
  checkOrgInviteAcceptRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: vi.fn(), PRICING: {} }));
vi.mock("@askarthur/supabase/server-auth", () => ({
  createAuthServerClient: async () => ({ auth: { signOut: vi.fn() } }),
}));

function chain(table: string) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const k of ["select", "eq", "is", "order", "limit", "in", "gt"]) c[k] = self;
  c.maybeSingle = async () => ({ data: table === "api_keys" ? m.key : null, error: null });
  c.single = async () => ({
    data: table === "org_invitations" ? m.invitation : null,
    error: table === "org_invitations" && !m.invitation ? { message: "none" } : null,
  });
  c.update = (u: unknown) => {
    if (table === "api_keys") m.keyUpdate(u);
    const r: Record<string, unknown> = {};
    r.eq = () => r;
    r.is = () => r;
    r.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ error: table === "api_keys" ? m.keyUpdateError : null }).then(res);
    return r;
  };
  c.insert = async (row: unknown) => {
    if (table === "org_members") m.memberInsert(row);
    return { error: null };
  };
  c.delete = () => ({ eq: async () => ({ error: null }) });
  return c;
}
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (t: string) => chain(t),
    auth: { admin: { deleteUser: async (id: string) => (m.deleteUser(id), { error: null }) } },
  }),
}));

import { DELETE as revokeKey } from "@/app/api/keys/[id]/route";
import { POST as invite } from "@/app/api/org/invite/route";
import { POST as accept } from "@/app/api/org/invite/accept/route";
import { POST as deleteAccount } from "@/app/api/user/delete-account/route";

const revoke = (id = "5") =>
  revokeKey(new NextRequest("https://x.test/api/keys/5", { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: "u1", email: "me@example.com" };
  m.org = null;
  m.key = null;
  m.invitation = null;
  m.keyUpdateError = null;
});

describe("DELETE /api/keys/[id]", () => {
  it("revokes the caller's own key", async () => {
    m.key = { id: 5, user_id: "u1", org_id: null };
    const res = await revoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(m.keyUpdate).toHaveBeenCalledWith({ is_active: false });
  });

  it("404s someone else's key and writes nothing", async () => {
    m.key = { id: 5, user_id: "u2", org_id: null };
    expect((await revoke()).status).toBe(404);
    expect(m.keyUpdate).not.toHaveBeenCalled();
  });

  it("lets an owner/admin of the key's org revoke it, not a viewer or another org", async () => {
    m.key = { id: 5, user_id: "u2", org_id: "o1" };
    m.org = { orgId: "o1", memberRole: "admin" };
    expect((await revoke()).status).toBe(200);
    m.org = { orgId: "o1", memberRole: "viewer" };
    expect((await revoke()).status).toBe(404);
    m.org = { orgId: "o2", memberRole: "owner" };
    expect((await revoke()).status).toBe(404);
  });

  it("404s a missing key", async () => {
    expect((await revoke()).status).toBe(404);
  });
});

describe("POST /api/org/invite — admin grants", () => {
  it("an admin cannot invite an admin", async () => {
    m.org = { orgId: "o1", memberRole: "admin", orgName: "Acme" };
    const res = await invite(post("https://x.test/api/org/invite", { email: "a@b.co", role: "admin" }));
    expect(res.status).toBe(403);
  });

  it("owner is never an invitable role", async () => {
    m.org = { orgId: "o1", memberRole: "owner", orgName: "Acme" };
    const res = await invite(post("https://x.test/api/org/invite", { email: "a@b.co", role: "owner" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/org/invite/accept — role re-check", () => {
  const base = {
    id: 1,
    org_id: "o1",
    email: "me@example.com",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    accepted_at: null,
  };

  it.each(["owner", "superuser", null])("refuses an invitation with role %j", async (role) => {
    m.invitation = { ...base, role };
    const res = await accept(post("https://x.test/api/org/invite/accept", { token: "t" }));
    expect(res.status).toBe(403);
    expect(m.memberInsert).not.toHaveBeenCalled();
  });

  it("accepts an assignable role", async () => {
    m.invitation = { ...base, role: "viewer" };
    await accept(post("https://x.test/api/org/invite/accept", { token: "t" }));
    expect(m.memberInsert).toHaveBeenCalledWith(expect.objectContaining({ role: "viewer" }));
  });
});

describe("POST /api/user/delete-account — key revocation", () => {
  it("revokes keys via is_active before deleting the auth user", async () => {
    const res = await deleteAccount(post("https://x.test/api/user/delete-account", { confirm: "DELETE" }));
    expect(res.status).toBe(200);
    expect(m.keyUpdate).toHaveBeenCalledWith({ is_active: false });
    expect(m.deleteUser).toHaveBeenCalledWith("u1");
  });

  it("stops the deletion when key revocation fails", async () => {
    m.keyUpdateError = { message: "db down" };
    const res = await deleteAccount(post("https://x.test/api/user/delete-account", { confirm: "DELETE" }));
    expect(res.status).toBe(500);
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
});
