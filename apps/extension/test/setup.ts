import { webcrypto } from "node:crypto";

// jsdom does no layout and omits a few APIs the detectors depend on. These
// shims give the fixtures deterministic layout semantics:
//
// - offsetWidth/offsetHeight: jsdom always reports 0, which would make every
//   visibility check in ad-detector treat every node as hidden. We report a
//   node as having width unless its inline style hides it — fixtures mark
//   Facebook's hidden decoy spans with style="display:none".
// - innerText: not implemented by jsdom; marketplace-detector's regex probes
//   read it. textContent is an acceptable stand-in for fixture HTML (no
//   layout-dependent text transformation in play).
// - naturalWidth/naturalHeight: jsdom never loads images, so both are 0.
//   Fixtures declare intrinsic size via width/height attributes and the shim
//   reflects them, keeping the ">= 100px real image" filters meaningful.
// - crypto.subtle: jsdom's window.crypto lacks subtle; bridge to node's.

function isInlineHidden(el: HTMLElement): boolean {
  const style = el.style;
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    (style.opacity !== "" && parseFloat(style.opacity) <= 0) ||
    (style.fontSize !== "" && parseFloat(style.fontSize) <= 0)
  );
}

Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return isInlineHidden(this) ? 0 : 100;
  },
});

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return isInlineHidden(this) ? 0 : 20;
  },
});

Object.defineProperty(HTMLElement.prototype, "innerText", {
  configurable: true,
  get(this: HTMLElement) {
    return this.textContent ?? "";
  },
});

for (const dim of ["naturalWidth", "naturalHeight"] as const) {
  const attr = dim === "naturalWidth" ? "width" : "height";
  Object.defineProperty(HTMLImageElement.prototype, dim, {
    configurable: true,
    get(this: HTMLImageElement) {
      return Number(this.getAttribute(attr)) || 0;
    },
  });
}

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}
