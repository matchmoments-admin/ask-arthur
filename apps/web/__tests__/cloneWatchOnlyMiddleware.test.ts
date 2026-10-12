import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The middleware gate end to end, with the flag really on. featureFlags reads
 * env at module load, so each case stubs env and re-imports. Go-red: deleting
 * the cloneWatchOnly block in middleware.ts fails the 503 and 307 cases.
 */
async function loadMiddleware(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) vi.stubEnv("FF_CLONE_WATCH_ONLY", "");
  else vi.stubEnv("FF_CLONE_WATCH_ONLY", flag);
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("NEXT_PUBLIC_FF_AUTH", "");
  return (await import("@/middleware")).middleware;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware in Clone-Watch-only mode", () => {
  it("503s a paused API with Retry-After", async () => {
    const mw = await loadMiddleware("true");
    const res = await mw(new NextRequest("https://askarthur.au/api/analyze", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("86400");
    expect(await res.json()).toEqual({ error: "paused" });
  });

  it("307s a paused page to /paused", async () => {
    const mw = await loadMiddleware("true");
    const res = await mw(new NextRequest("https://askarthur.au/charity-check?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://askarthur.au/paused");
  });

  it("still demands CRON_SECRET on a kept cron route", async () => {
    const mw = await loadMiddleware("true");
    const res = await mw(new NextRequest("https://askarthur.au/api/cron/health-digest"));
    expect(res.status).toBe(401);
  });

  it("does nothing when the flag is off", async () => {
    const mw = await loadMiddleware(undefined);
    const res = await mw(new NextRequest("https://askarthur.au/api/cron/weekly-email"));
    // Unchanged path: the cron-secret check, not the pause gate.
    expect(res.status).toBe(401);
    const page = await mw(new NextRequest("https://askarthur.au/charity-check"));
    expect(page.status).not.toBe(307);
  });
});
