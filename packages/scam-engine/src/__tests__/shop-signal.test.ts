import { describe, expect, it } from "vitest";

import {
  buildShopSignal,
  detectCommerceSignal,
  extractCommerceFlags,
} from "../shop-signal";

describe("detectCommerceSignal", () => {
  describe("URL-side signals", () => {
    it("fires on commerce TLDs", () => {
      expect(detectCommerceSignal(null, ["https://designer-bags.shop"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://luxury-deals.store"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://discount-au.top"])).toBe(true);
    });

    it("fires on cart/checkout paths", () => {
      expect(detectCommerceSignal(null, ["https://example.com/cart"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://example.com/checkout"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://example.com/products/foo"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://example.com/collections/sale"])).toBe(true);
    });

    it("fires on Shopify/WooCommerce/Sellvia platform hints in hostname", () => {
      expect(detectCommerceSignal(null, ["https://my-store.shopify.com"])).toBe(true);
      expect(detectCommerceSignal(null, ["https://sellvia-store.example.com"])).toBe(true);
    });

    it("handles protocol-less URLs (extractURLs sometimes passes these)", () => {
      expect(detectCommerceSignal(null, ["bag-outlet.shop/cart"])).toBe(true);
    });

    it("returns false for non-commerce URLs", () => {
      expect(detectCommerceSignal(null, ["https://example.com"])).toBe(false);
      expect(detectCommerceSignal(null, ["https://news.com.au/article"])).toBe(false);
    });

    it("returns false for malformed URLs without crashing", () => {
      expect(detectCommerceSignal(null, ["not a url"])).toBe(false);
      expect(detectCommerceSignal(null, [""])).toBe(false);
    });
  });

  describe("text-side signals", () => {
    it("fires on commerce verbs", () => {
      expect(detectCommerceSignal("Add to cart and check out today")).toBe(true);
      expect(detectCommerceSignal("BUY NOW — 70% off")).toBe(true);
      expect(detectCommerceSignal("Free shipping on all orders")).toBe(true);
      expect(detectCommerceSignal("Limited stock — closing down sale")).toBe(true);
    });

    it("returns false for non-commerce text", () => {
      expect(detectCommerceSignal("Hi mum it's me my phone is broken")).toBe(false);
      expect(detectCommerceSignal("Your ATO refund is ready")).toBe(false);
    });

    it("returns false for null/undefined input", () => {
      expect(detectCommerceSignal(null)).toBe(false);
      expect(detectCommerceSignal(undefined)).toBe(false);
      expect(detectCommerceSignal("")).toBe(false);
    });
  });

  describe("combined", () => {
    it("fires when URL OR text carries a signal (OR, not AND)", () => {
      // URL signal only
      expect(detectCommerceSignal("not commerce text", ["https://x.shop"])).toBe(true);
      // Text signal only
      expect(detectCommerceSignal("add to cart", ["https://example.com"])).toBe(true);
      // Both
      expect(detectCommerceSignal("buy now", ["https://x.shop/cart"])).toBe(true);
    });
  });
});

describe("extractCommerceFlags", () => {
  it("returns empty array when no commerce-shaped flag matches", () => {
    expect(extractCommerceFlags([])).toEqual([]);
    expect(
      extractCommerceFlags([
        "Sender claims to be from the ATO",
        "Urgency tactics — 'act now or your account is closed'",
      ]),
    ).toEqual([]);
  });

  it("extracts payid-scam tag", () => {
    const tags = extractCommerceFlags([
      "Email claims to be from PayID — PayID never sends emails",
    ]);
    expect(tags).toContain("payid-scam");
  });

  it("extracts relative-will-collect tag", () => {
    const tags = extractCommerceFlags([
      "Buyer says a relative will collect on their behalf",
    ]);
    expect(tags).toContain("relative-will-collect");
  });

  it("extracts overpayment-refund tag", () => {
    expect(
      extractCommerceFlags(["Classic overpayment scam — wants refund of the difference"]),
    ).toContain("overpayment-refund");
  });

  it("extracts multiple tags from a single flag list", () => {
    const tags = extractCommerceFlags([
      "Fake PayID confirmation email from a Gmail address",
      "Buyer wants to move communication to WhatsApp",
      "First to deposit can pick it up — urgent pressure",
    ]);
    expect(tags).toContain("payid-scam");
    expect(tags).toContain("fake-payment-confirmation");
    expect(tags).toContain("off-platform-move");
    expect(tags).toContain("urgent-purchase-pressure");
  });

  it("deduplicates — each tag appears at most once", () => {
    const tags = extractCommerceFlags([
      "PayID scam variant 1",
      "PayID scam variant 2",
      "Another PayID-related red flag",
    ]);
    expect(tags.filter((t) => t === "payid-scam")).toHaveLength(1);
  });

  it("is case-insensitive on input flags", () => {
    expect(extractCommerceFlags(["PAYID FAKE EMAIL"])).toContain("payid-scam");
    expect(extractCommerceFlags(["payid fake email"])).toContain("payid-scam");
  });
});

describe("buildShopSignal", () => {
  it("returns isCommerce: true with empty commerceFlags when no flag matched", () => {
    const out = buildShopSignal(["Unrelated red flag"]);
    expect(out.isCommerce).toBe(true);
    expect(out.commerceFlags).toEqual([]);
    expect(out.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns extracted commerceFlags when commerce-shaped red flags present", () => {
    const out = buildShopSignal([
      "Fake PayID email from Gmail address",
      "Stock photo product images on Marketplace listing",
    ]);
    expect(out.commerceFlags).toContain("payid-scam");
    expect(out.commerceFlags).toContain("stock-photo-product");
  });

  it("ISO-8601 generatedAt is valid", () => {
    const out = buildShopSignal([]);
    expect(() => new Date(out.generatedAt)).not.toThrow();
    expect(new Date(out.generatedAt).toISOString()).toBe(out.generatedAt);
  });
});
