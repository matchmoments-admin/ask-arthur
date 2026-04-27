import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const mockGetUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUser: () => mockGetUser(),
}));

type Row = Record<string, unknown>;

// Per-table single-row queue. Each table can have multiple sequential .single() reads.
const tableQueues: Record<string, Array<{ data: Row | null; error: unknown }>> = {};
const inserts: Record<string, Row[]> = {};
const updates: Record<string, Row[]> = {};

function queueRow(table: string, data: Row | null, error: unknown = null) {
  tableQueues[table] ||= [];
  tableQueues[table].push({ data, error });
}

function makeBuilder(table: string) {
  const next = () => {
    const q = tableQueues[table] ?? [];
    return q.shift() ?? { data: null, error: null };
  };
  // Chainable thenable: every .select/.eq/.is returns the same builder; .single() resolves.
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.single = () => Promise.resolve(next());
  builder.insert = (row: Row) => {
    inserts[table] ||= [];
    inserts[table].push(row);
    return Promise.resolve({ error: null });
  };
  builder.update = (row: Row) => {
    updates[table] ||= [];
    updates[table].push(row);
    // .update().eq() returns a thenable
    return {
      eq: () => Promise.resolve({ error: null }),
    };
  };
  return builder;
}

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

const { POST } = await import("@/app/api/org/invite/accept/route");

// ── Helpers ──

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/org/invite/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  for (const k of Object.keys(inserts)) delete inserts[k];
  for (const k of Object.keys(updates)) delete updates[k];
});

// ── Tests ──

describe("POST /api/org/invite/accept — invited-email binding", () => {
  it("rejects 403 when signed-in user's email differs from the invited email", async () => {
    mockGetUser.mockResolvedValueOnce({
      id: "user-b",
      email: "userB@example.com",
      role: "user",
      displayName: null,
      orgId: null,
      orgRole: null,
      orgName: null,
    });

    queueRow("org_invitations", {
      id: 1,
      org_id: "org-1",
      email: "userA@example.com",
      role: "fraud_analyst",
      expires_at: FUTURE,
      accepted_at: null,
    });

    const res = await POST(makeRequest({ token: "raw-token-bytes" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/different email address/i);

    // The route must NOT proceed to write a member row when emails don't match.
    expect(inserts["org_members"]).toBeUndefined();
    expect(updates["org_invitations"]).toBeUndefined();
  });

  it("accepts when emails match case-insensitively (with surrounding whitespace tolerated)", async () => {
    mockGetUser.mockResolvedValueOnce({
      id: "user-a",
      email: "  UserA@Example.com  ",
      role: "user",
      displayName: null,
      orgId: null,
      orgRole: null,
      orgName: null,
    });

    queueRow("org_invitations", {
      id: 1,
      org_id: "org-1",
      email: "usera@example.com",
      role: "fraud_analyst",
      expires_at: FUTURE,
      accepted_at: null,
    });
    // Membership lookup: not yet a member → null row
    queueRow("org_members", null);
    // Org name lookup
    queueRow("organizations", { name: "Acme Bank" });

    const res = await POST(makeRequest({ token: "raw-token-bytes" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.orgName).toBe("Acme Bank");
    expect(body.role).toBe("fraud_analyst");

    // Confirms the route proceeded to write the member and mark the invitation accepted.
    expect(inserts["org_members"]).toHaveLength(1);
    expect(updates["org_invitations"]).toHaveLength(1);
  });

  it("returns 401 when no user is signed in (auth gate runs before the email check)", async () => {
    mockGetUser.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ token: "raw-token-bytes" }));

    expect(res.status).toBe(401);
    expect(inserts["org_members"]).toBeUndefined();
  });
});
