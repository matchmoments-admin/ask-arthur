import { describe, expect, it } from "vitest";
import { hostOf } from "@/lib/clone-alert-lookup";

describe("hostOf (clone-alert lookup host extraction)", () => {
  it("extracts the host from a full URL and lowercases it", () => {
    expect(hostOf("https://Bunnings-Sale.SHOP/deals?x=1")).toBe(
      "bunnings-sale.shop",
    );
    expect(hostOf("http://auspost-redelivery.shop/track")).toBe(
      "auspost-redelivery.shop",
    );
  });

  it("accepts a bare host (no scheme)", () => {
    expect(hostOf("commbank-login.shop")).toBe("commbank-login.shop");
  });

  it("strips a leading www. so it matches the NRD-registered domain", () => {
    expect(hostOf("https://www.telstra-rewards.shop")).toBe(
      "telstra-rewards.shop",
    );
    expect(hostOf("www.paypal-secure.shop")).toBe("paypal-secure.shop");
  });

  it("returns null for empty / unparseable input", () => {
    expect(hostOf("")).toBeNull();
    expect(hostOf("   ")).toBeNull();
    expect(hostOf("not a url with spaces")).toBeNull();
  });
});
