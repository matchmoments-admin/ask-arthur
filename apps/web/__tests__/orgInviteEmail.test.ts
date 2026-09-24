import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Org invitations: the org name (set by the org's creator) is escaped in the
// email body and flattened in the subject; sends are rate-limited per inviter.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getOrg: vi.fn(),
  limit: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUser: mocks.getUser }));
vi.mock("@/lib/org", () => ({ getOrg: mocks.getOrg }));
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkOrgInviteSendRateLimit: mocks.limit,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: vi.fn(), PRICING: {} }));

import { buildOrgInviteEmail } from "@/lib/email/org-invite";
import { escapeHtml, headerSafe } from "@/lib/escape-html";
import { POST } from "@/app/api/org/invite/route";

const req = () =>
  new NextRequest("https://askarthur.au/api/org/invite", {
    method: "POST",
    body: JSON.stringify({ email: "new@example.com", role: "viewer" }),
  });

describe("escapeHtml / headerSafe", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("flattens control characters and caps length for a header value", () => {
    expect(headerSafe("Acme\r\nBcc: x@y.z")).toBe("Acme Bcc: x@y.z");
    expect(headerSafe("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("buildOrgInviteEmail", () => {
  const out = buildOrgInviteEmail({
    orgName: `Acme <b onclick="x">Pty</b>\nLtd`,
    role: "fraud_analyst",
    inviteUrl: "https://askarthur.au/invite/abc",
  });

  it("never emits the org name's markup unescaped in the body", () => {
    expect(out.html).not.toContain("<b onclick");
    expect(out.html).toContain("Acme &lt;b onclick=&quot;x&quot;&gt;Pty&lt;/b&gt;");
    expect(out.html).toContain("fraud analyst");
  });

  it("keeps the subject to a single line", () => {
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe("POST /api/org/invite rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ id: "u1" });
    mocks.getOrg.mockResolvedValue({ orgId: "o1", orgName: "Acme", memberRole: "owner" });
  });

  it("returns 429 with Retry-After and touches nothing when the inviter is over quota", async () => {
    mocks.limit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
      message: "Too many invitations sent. Try again later.",
      reason: "exceeded",
    });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mocks.limit).toHaveBeenCalledWith("u1");
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it("checks the quota only after the caller is known to be an org owner/admin", async () => {
    mocks.getOrg.mockResolvedValue({ orgId: "o1", orgName: "Acme", memberRole: "viewer" });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
