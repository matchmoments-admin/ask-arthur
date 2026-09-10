import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), prepare: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: mocks.auth }));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/newsletter/prepare", () => ({ prepareNewsletter: mocks.prepare }));
import { GET } from "@/app/api/cron/weekly-email/route";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(null); mocks.client.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ error: null }); mocks.prepare.mockResolvedValue({ id: "issue-1" }); });
it("prepares only and returns the reviewable issue", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const response = await GET(new NextRequest("https://askarthur.au/api/cron/weekly-email"));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ issueId: "issue-1" });
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
});
it("rejects anonymous cron calls before database work", async () => {
  mocks.auth.mockReturnValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  expect((await GET(new NextRequest("https://askarthur.au/api/cron/weekly-email"))).status).toBe(401);
  expect(mocks.client).not.toHaveBeenCalled();
});
it("fails visibly when confirmation cleanup fails", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "down" } });
  expect((await GET(new NextRequest("https://askarthur.au/api/cron/weekly-email"))).status).toBe(503);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
