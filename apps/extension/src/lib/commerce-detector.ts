// Commerce-page detector for the Shop Signal popup (#323).
//
// `detectCommerceSignals` is injected one-shot into the active tab via
// `chrome.scripting.executeScript({ func })`. Chrome serialises the
// function with `.toString()` and re-evaluates it in the page, so it MUST
// be fully self-contained:
//   - no imports, no module-scope constants, no closure references;
//   - only page globals (`document`) and its own locals.
// The `CommerceDetectionResult` type annotation is erased at compile time,
// so referencing it in the signature is safe. Kept to ES2019 syntax (no
// optional chaining / nullish coalescing / spread) so the bundler never
// injects a transpilation helper that would break serialisation.

export interface CommerceDetectionResult {
  /** True when at least two of the three commerce signals fired. */
  isShop: boolean;
  /** Which signals matched — surfaced for display + telemetry. */
  signals: string[];
}

export function detectCommerceSignals(): CommerceDetectionResult {
  const signals: string[] = [];

  // Signal 1 — schema.org Product (JSON-LD or microdata).
  try {
    let productSchema = false;
    const ldNodes = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    for (let i = 0; i < ldNodes.length; i++) {
      const raw = ldNodes[i].textContent;
      if (raw && /"@type"\s*:\s*"(Product|AggregateOffer)"/i.test(raw)) {
        productSchema = true;
        break;
      }
    }
    const microdata = document.querySelector(
      '[itemtype*="schema.org/Product" i]',
    );
    if (productSchema || microdata) signals.push("schema-product");
  } catch {
    /* page DOM unavailable — skip this signal */
  }

  // Signal 2 — a checkout / cart / payment form.
  try {
    const checkoutForm = document.querySelector(
      'form[action*="checkout" i], form[action*="/cart" i], form[action*="payment" i]',
    );
    const cardInput = document.querySelector(
      'input[autocomplete="cc-number"], input[name*="cardnumber" i], input[name*="card-number" i]',
    );
    const addToCart = document.querySelector(
      '[class*="add-to-cart" i], [id*="add-to-cart" i], [data-add-to-cart]',
    );
    if (checkoutForm || cardInput || addToCart) signals.push("checkout-form");
  } catch {
    /* skip */
  }

  // Signal 3 — a known commerce-platform marker.
  try {
    let platform: string | null = null;
    if (
      document.querySelector(
        'script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"]',
      )
    ) {
      platform = "shopify";
    } else {
      const body = document.body;
      const wooClass =
        !!body &&
        (body.classList.contains("woocommerce") ||
          body.classList.contains("woocommerce-page"));
      const wooAsset = document.querySelector(
        'link[href*="/plugins/woocommerce"], script[src*="/plugins/woocommerce"]',
      );
      if (wooClass || wooAsset) {
        platform = "woocommerce";
      } else {
        const genMeta = document.querySelector('meta[name="generator"]');
        const genContent = genMeta ? genMeta.getAttribute("content") : null;
        const gen = genContent ? genContent.toLowerCase() : "";
        if (gen.includes("shopify")) platform = "shopify";
        else if (gen.includes("woocommerce")) platform = "woocommerce";
        else if (gen.includes("bigcommerce")) platform = "bigcommerce";
      }
    }
    if (!platform && document.querySelector('script[src*="bigcommerce.com"]')) {
      platform = "bigcommerce";
    }
    if (platform) signals.push("platform-" + platform);
  } catch {
    /* skip */
  }

  return { isShop: signals.length >= 2, signals };
}
