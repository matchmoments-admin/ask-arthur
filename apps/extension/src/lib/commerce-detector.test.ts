import { describe, it, expect, beforeEach } from "vitest";
import { detectCommerceSignals } from "./commerce-detector";

// Renders a fixture page into the jsdom document. detectCommerceSignals
// reads the global `document`, mirroring how it runs once injected into a
// real tab via chrome.scripting.executeScript.
function render(opts: { head?: string; body?: string; bodyClass?: string }) {
  document.head.innerHTML = opts.head ?? "";
  document.body.innerHTML = opts.body ?? "";
  document.body.className = opts.bodyClass ?? "";
}

describe("detectCommerceSignals", () => {
  beforeEach(() => {
    render({});
  });

  it("flags a real shop — schema Product + checkout form + Shopify (3 signals)", () => {
    render({
      head: `
        <script src="https://cdn.shopify.com/s/files/app.js"></script>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"Widget"}
        </script>
      `,
      body: `<form action="/cart/checkout"><button name="add">Buy</button></form>`,
    });
    const result = detectCommerceSignals();
    expect(result.isShop).toBe(true);
    expect(result.signals).toEqual(
      expect.arrayContaining([
        "schema-product",
        "checkout-form",
        "platform-shopify",
      ]),
    );
  });

  it("flags a WooCommerce product page — body class + Product microdata (2 signals)", () => {
    render({
      bodyClass: "woocommerce-page single-product",
      body: `
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Thing</span>
        </div>
      `,
    });
    const result = detectCommerceSignals();
    expect(result.isShop).toBe(true);
    expect(result.signals).toContain("schema-product");
    expect(result.signals).toContain("platform-woocommerce");
  });

  it("does not flag a non-shop page (zero signals)", () => {
    render({
      head: `<title>A blog post</title>`,
      body: `<article><p>Just some words about nothing in particular.</p></article>`,
    });
    const result = detectCommerceSignals();
    expect(result.isShop).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it("does not flag a one-signal page (below the two-of-three bar)", () => {
    // A payment-shaped form and nothing else — one signal is not enough.
    render({
      head: `<title>Newsletter signup</title>`,
      body: `<form action="/payment-newsletter"><input name="email" /></form>`,
    });
    const result = detectCommerceSignals();
    expect(result.signals).toEqual(["checkout-form"]);
    expect(result.isShop).toBe(false);
  });
});
