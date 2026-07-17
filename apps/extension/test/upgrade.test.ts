import { describe, it, expect, vi, beforeEach } from "vitest";
import { openUpgradePage } from "@/lib/upgrade";

// __EXTENSION_BILLING_ENABLED__ is a build-time define; under vitest it is
// undefined, so openUpgradePage takes the pricing-fallback path. The
// billing-enabled path is exercised in the manual smoke (build-flag matrix
// in docs/ops/extension-billing-config.md).

const chromeMock = {
  runtime: { sendMessage: vi.fn() },
  tabs: { create: vi.fn(async () => ({})) },
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).chrome = chromeMock;
});

describe("openUpgradePage", () => {
  it("falls back to the pricing page with the ref when billing define is absent", async () => {
    await openUpgradePage("extension_limit");
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: "https://askarthur.au/pricing?ref=extension_limit",
    });
  });

  it("URL-encodes the ref", async () => {
    await openUpgradePage("a b&c");
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: "https://askarthur.au/pricing?ref=a%20b%26c",
    });
  });
});
