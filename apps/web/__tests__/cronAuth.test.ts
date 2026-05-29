import { describe, it, expect, afterEach } from "vitest";
import { requireCronAuth } from "@/lib/cron-auth";

const ORIGINAL = process.env.CRON_SECRET;

function reqWith(authHeader?: string): Request {
  return new Request("https://askarthur.au/api/cron/whatever", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("requireCronAuth", () => {
  it("fails CLOSED when CRON_SECRET is unset (no 'Bearer undefined' bypass)", () => {
    delete process.env.CRON_SECRET;
    // The historical bug: `Bearer ${process.env.CRON_SECRET}` === "Bearer undefined"
    expect(requireCronAuth(reqWith("Bearer undefined"))?.status).toBe(401);
    expect(requireCronAuth(reqWith(undefined))?.status).toBe(401);
  });

  it("fails CLOSED when CRON_SECRET is an empty string", () => {
    process.env.CRON_SECRET = "";
    expect(requireCronAuth(reqWith("Bearer "))?.status).toBe(401);
  });

  it("authorizes the exact matching Bearer token", () => {
    process.env.CRON_SECRET = "s3cret-token";
    expect(requireCronAuth(reqWith("Bearer s3cret-token"))).toBeNull();
  });

  it("rejects a wrong token", () => {
    process.env.CRON_SECRET = "s3cret-token";
    expect(requireCronAuth(reqWith("Bearer wrong"))?.status).toBe(401);
  });

  it("rejects a missing Authorization header", () => {
    process.env.CRON_SECRET = "s3cret-token";
    expect(requireCronAuth(reqWith(undefined))?.status).toBe(401);
  });

  it("rejects a length-mismatched header without throwing (timing-safe compare)", () => {
    process.env.CRON_SECRET = "s3cret-token";
    expect(requireCronAuth(reqWith("Bearer s3cret-token-extra"))?.status).toBe(
      401
    );
    expect(requireCronAuth(reqWith("x"))?.status).toBe(401);
  });
});
