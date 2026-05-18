// Coverage for the featureGate helper. Goal: verify each gate throws the
// correct Next.js navigation signal when the flag is off, and is a no-op
// when on.
//
// `notFound()` and `redirect()` throw special errors that Next.js converts
// into HTTP responses. We mock both to capture the throw.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file by vitest, so the factory
// can't close over module-level state. vi.hoisted runs alongside the
// hoisted mocks so we can share a mutable flag map between the mock
// factory and the tests.
const { flagState } = vi.hoisted(() => ({
  flagState: { charityCheck: false, billing: false } as Record<string, boolean>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    const err = new Error("NEXT_NOT_FOUND");
    (err as Error & { digest?: string }).digest = "NEXT_NOT_FOUND";
    throw err;
  }),
  redirect: vi.fn((to: string) => {
    const err = new Error(`NEXT_REDIRECT;${to}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;push;${to}`;
    throw err;
  }),
}));

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy(flagState, {
    get: (target, prop: string) => target[prop] ?? false,
  }),
}));

import { gateOrNotFound, gateOrRedirect } from "../featureGate";
import { notFound, redirect } from "next/navigation";

beforeEach(() => {
  vi.clearAllMocks();
  flagState.charityCheck = false;
  flagState.billing = false;
});

describe("gateOrNotFound", () => {
  it("calls notFound() when the flag is off", () => {
    flagState.charityCheck = false;
    expect(() =>
      gateOrNotFound("charityCheck" as Parameters<typeof gateOrNotFound>[0]),
    ).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("is a no-op when the flag is on", () => {
    flagState.charityCheck = true;
    expect(() =>
      gateOrNotFound("charityCheck" as Parameters<typeof gateOrNotFound>[0]),
    ).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("gateOrRedirect", () => {
  it("calls redirect(to) when the flag is off", () => {
    flagState.billing = false;
    expect(() =>
      gateOrRedirect(
        "billing" as Parameters<typeof gateOrRedirect>[0],
        "/app",
      ),
    ).toThrow("NEXT_REDIRECT;/app");
    expect(redirect).toHaveBeenCalledWith("/app");
  });

  it("is a no-op when the flag is on", () => {
    flagState.billing = true;
    expect(() =>
      gateOrRedirect(
        "billing" as Parameters<typeof gateOrRedirect>[0],
        "/app",
      ),
    ).not.toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });
});
