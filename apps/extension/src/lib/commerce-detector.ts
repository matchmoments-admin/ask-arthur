// Commerce-page DOM detector — Stage 2 PR 6.
//
// Run once when the extension popup opens, via
// chrome.scripting.executeScript({ target: { tabId }, func: detectCommerce })
// on the active tab. Returns a JSON-serialisable verdict that the popup
// uses to decide whether to call the analyze endpoint and render the
// ShopSignalCard, or fall through to the standard CheckTab.
//
// CRITICAL constraint: this function is serialised across the
// content-isolated world boundary via Function.prototype.toString. It
// MUST NOT close over any module-scope identifier — no imports, no
// shared helpers, no top-level constants captured by reference. Every
// identifier the body references must be either a built-in browser
// global (document, window, JSON, ...) or a local declared inside the
// function itself.
//
// Two-of-three rule (anchored on Sánchez-Paniagua 2022's commerce-
// detection feature set):
//   1. schema.org Product — JSON-LD `@type: Product` OR microdata
//      `[itemtype*="schema.org/Product"]`. Real shops embed this for
//      Google rich shopping results; blogs and news pages don't.
//   2. Payment / checkout form — a form with credit-card autocomplete
//      hints, or a form whose action / id mentions "checkout".
//   3. Platform marker — Shopify / WooCommerce / BigCommerce signature
//      in `<meta name="generator">` OR `window.Shopify` presence.
//
// isShop = at least 2 of 3 fire. Single-signal pages (a blog with a
// schema.org Product widget for affiliate purposes; a login page with
// a payment form) are deliberately rejected.

export interface CommerceDetectorResult {
  isShop: boolean;
  signals: Array<"schema-product" | "checkout-form" | "platform-marker">;
}

/**
 * Self-contained DOM detector. Safe to pass directly to
 * chrome.scripting.executeScript({ func: detectCommerce }).
 */
export function detectCommerce(): CommerceDetectorResult {
  const signals: CommerceDetectorResult["signals"] = [];

  // ── Signal 1: schema.org Product ─────────────────────────────────────
  let hasProduct = false;
  const ldScripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  for (const script of Array.from(ldScripts)) {
    const raw = script.textContent;
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const nodes: unknown[] = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const t = (node as { "@type"?: unknown })["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
          hasProduct = true;
          break;
        }
        // Schema.org @graph aggregates — peek inside.
        const graph = (node as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(graph)) {
          for (const g of graph) {
            if (!g || typeof g !== "object") continue;
            const gt = (g as { "@type"?: unknown })["@type"];
            if (gt === "Product" || (Array.isArray(gt) && gt.includes("Product"))) {
              hasProduct = true;
              break;
            }
          }
        }
        if (hasProduct) break;
      }
    } catch {
      // Malformed JSON-LD on the page — skip silently.
    }
    if (hasProduct) break;
  }
  if (!hasProduct) {
    // Microdata fallback.
    if (document.querySelector('[itemtype*="schema.org/Product" i]')) {
      hasProduct = true;
    }
  }
  if (hasProduct) signals.push("schema-product");

  // ── Signal 2: payment / checkout form ────────────────────────────────
  let hasCheckoutForm = false;
  const ccAutocomplete = document.querySelector(
    'form input[autocomplete*="cc-" i]',
  );
  if (ccAutocomplete) {
    hasCheckoutForm = true;
  } else {
    const forms = document.querySelectorAll<HTMLFormElement>("form");
    for (const form of Array.from(forms)) {
      const action = (form.getAttribute("action") || "").toLowerCase();
      const id = (form.id || "").toLowerCase();
      const cls = (form.className || "").toString().toLowerCase();
      if (
        action.includes("checkout") ||
        action.includes("cart") ||
        id.includes("checkout") ||
        cls.includes("checkout")
      ) {
        hasCheckoutForm = true;
        break;
      }
    }
  }
  if (hasCheckoutForm) signals.push("checkout-form");

  // ── Signal 3: platform marker ────────────────────────────────────────
  let hasPlatform = false;
  const gen = document.querySelector<HTMLMetaElement>(
    'meta[name="generator" i]',
  );
  if (gen) {
    const content = (gen.getAttribute("content") || "").toLowerCase();
    if (
      content.includes("shopify") ||
      content.includes("woocommerce") ||
      content.includes("bigcommerce") ||
      content.includes("magento") ||
      content.includes("prestashop")
    ) {
      hasPlatform = true;
    }
  }
  if (!hasPlatform) {
    // Shopify exposes a global on the storefront. Other platforms rely on
    // their server-rendered markup, so the meta check above covers them.
    if (typeof (window as unknown as { Shopify?: unknown }).Shopify !== "undefined") {
      hasPlatform = true;
    }
  }
  if (!hasPlatform) {
    // Body classes are a soft signal but worth checking for the common
    // platforms that don't always emit the meta generator (e.g. WP +
    // WooCommerce themes that strip it for SEO reasons).
    const bodyCls = (document.body?.className || "").toString().toLowerCase();
    if (
      bodyCls.includes("woocommerce") ||
      bodyCls.includes("shopify") ||
      bodyCls.includes("bigcommerce")
    ) {
      hasPlatform = true;
    }
  }
  if (hasPlatform) signals.push("platform-marker");

  return {
    isShop: signals.length >= 2,
    signals,
  };
}
