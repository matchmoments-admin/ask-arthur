import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u-admin" } as { id: string } | null,
  org: { orgId: "o1", memberRole: "admin" } as { orgId: string; memberRole: string } | null,
  target: null as null | { id: number; user_id: string; role: string },
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUser: async () => mocks.user }));
vi.mock("@/lib/org", () => ({ getOrg: async () => mocks.org }));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: mocks.target, error: null });
      chain.update = (u: unknown) => {
        mocks.update(u);
        const upd: Record<string, unknown> = {};
        upd.eq = () => upd;
        upd.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
        return upd;
      };
      return chain;
    },
  }),
}));

import { PATCH } from "@/app/api/org/members/route";

const patch = (body: unknown) =>
  PATCH(
    new Request("https://x.test/api/org/members", {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u-admin" };
  mocks.org = { orgId: "o1", memberRole: "admin" };
  mocks.target = { id: 7, user_id: "u-other", role: "viewer" };
});

describe("PATCH /api/org/members", () => {
  it("updates an assignable role", async () => {
    const res = await patch({ memberId: 7, role: "developer" });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ role: "developer" });
  });

  it.each([
    ["owner is never assignable", { memberId: 7, role: "owner" }, 400],
    ["unknown status", { memberId: 7, status: "superuser" }, 400],
    ["nothing to change", { memberId: 7 }, 400],
  ])("rejects: %s", async (_label, body, code) => {
    const res = await patch(body);
    expect(res.status).toBe(code);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("never edits the owner's row", async () => {
    mocks.target = { id: 7, user_id: "u-owner", role: "owner" };
    expect((await patch({ memberId: 7, status: "deactivated" })).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("never edits the caller's own membership", async () => {
    mocks.target = { id: 7, user_id: "u-admin", role: "admin" };
    expect((await patch({ memberId: 7, role: "viewer" })).status).toBe(403);
  });

  it("only the owner manages admins", async () => {
    expect((await patch({ memberId: 7, role: "admin" })).status).toBe(403);
    mocks.target = { id: 7, user_id: "u-other", role: "admin" };
    expect((await patch({ memberId: 7, status: "deactivated" })).status).toBe(403);
    mocks.org = { orgId: "o1", memberRole: "owner" };
    mocks.user = { id: "u-owner" };
    expect((await patch({ memberId: 7, status: "deactivated" })).status).toBe(200);
  });

  it("404s a member of another org", async () => {
    mocks.target = null;
    expect((await patch({ memberId: 99, role: "viewer" })).status).toBe(404);
  });
});
