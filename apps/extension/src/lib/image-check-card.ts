// In-page result card for the right-click image check.
//
// IMPORTANT CONSTRAINT: renderImageCheckCard is injected into the page via
// chrome.scripting.executeScript({ func, args }) — Chrome SERIALIZES the
// function source, so it must be fully self-contained: no imports, no
// references to anything outside its own body, all data via the single
// payload argument. It is also called directly under jsdom in tests.
//
// The card is a closed shadow-DOM host anchored near the checked image
// (same isolation approach as the Facebook ad banner). Calling it again
// with the same imageUrl updates the existing card in place — that's how
// pending → result/error transitions work across two executeScript calls.

export interface ImageCheckCardPayload {
  state: "pending" | "result" | "error";
  imageUrl: string;
  /** result state */
  aiLine?: string;
  deepfakeLine?: string;
  generatorSource?: string | null;
  /** Pre-formatted "Midjourney — 62%" lines (top generators). When present,
   *  replaces the single generatorSource line. */
  generatorLines?: string[];
  /** Pre-formatted vision-context sentence (what the image appears to show). */
  contextLine?: string;
  /** Google Lens reverse-image link (precomputed by the background). */
  lensUrl?: string;
  /** Pre-formatted Content Credentials line ("Content Credentials present
   *  (issuer unverified)") — only set when a manifest was detected. */
  contentCredentialsLine?: string;
  /** Evidence-record reference (IC-…) — shown when the check was persisted. */
  evidenceRef?: string;
  /** Link to the public evidence page (precomputed by the background). */
  evidenceUrl?: string;
  checksRemaining?: number | null;
  disclaimer?: string;
  /** error state (incl. friendly unsupported/limit copy) */
  errorMessage?: string;
}

export function renderImageCheckCard(payload: {
  state: "pending" | "result" | "error";
  imageUrl: string;
  aiLine?: string;
  deepfakeLine?: string;
  generatorSource?: string | null;
  generatorLines?: string[];
  contextLine?: string;
  lensUrl?: string;
  contentCredentialsLine?: string;
  evidenceRef?: string;
  evidenceUrl?: string;
  checksRemaining?: number | null;
  disclaimer?: string;
  errorMessage?: string;
}): void {
  const HOST_CLASS = "arthur-image-check-card";

  // Reuse the existing host for this image if present (pending → result).
  let host: HTMLElement | null = null;
  const hosts = document.querySelectorAll<HTMLElement>(`.${HOST_CLASS}`);
  for (const h of hosts) {
    if (h.dataset.arthurImageUrl === payload.imageUrl) {
      host = h;
      break;
    }
  }

  let shadow: ShadowRoot;
  if (host?.shadowRoot) {
    shadow = host.shadowRoot;
  } else if (host) {
    // Closed shadow roots aren't re-accessible via .shadowRoot — rebuild.
    host.remove();
    host = null;
    shadow = null as unknown as ShadowRoot;
  } else {
    shadow = null as unknown as ShadowRoot;
  }

  if (!host) {
    host = document.createElement("div");
    host.className = HOST_CLASS;
    host.dataset.arthurImageUrl = payload.imageUrl;
    host.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:340px;";
    // open (not closed) so a follow-up injection can update in place.
    shadow = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }

  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const baseStyle = `
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      .card {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background:#1c1917; color:#fafaf9; border-radius:12px;
        border:1px solid #44403c; box-shadow:0 8px 24px rgba(0,0,0,.35);
        padding:14px 16px; font-size:13px; line-height:1.45;
      }
      .head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
      .brand { font-weight:600; font-size:12px; letter-spacing:.02em; color:#fbbf24; }
      .close { cursor:pointer; background:none; border:none; color:#a8a29e; font-size:14px; line-height:1; padding:2px 4px; }
      .line { margin:4px 0; }
      .sub { margin:2px 0 2px 22px; font-size:12px; color:#d6d3d1; }
      .muted { color:#a8a29e; font-size:11px; margin-top:8px; }
      .spin { color:#d6d3d1; }
      .err { color:#fca5a5; }
      .lens { display:inline-block; margin-top:8px; font-size:12px; color:#93c5fd; text-decoration:underline; cursor:pointer; }
    </style>`;

  let body = "";
  if (payload.state === "pending") {
    body = `<div class="line spin">Checking this image for AI generation…</div>`;
  } else if (payload.state === "error") {
    body = `<div class="line err">${esc(payload.errorMessage ?? "Couldn't check this image.")}</div>`;
  } else {
    const lines: string[] = [];
    if (payload.aiLine) lines.push(`<div class="line">🖼️ ${esc(payload.aiLine)}</div>`);
    if (payload.deepfakeLine) lines.push(`<div class="line">🎭 ${esc(payload.deepfakeLine)}</div>`);
    if (payload.generatorLines && payload.generatorLines.length > 0) {
      for (const gl of payload.generatorLines) {
        lines.push(`<div class="sub">${esc(gl)}</div>`);
      }
    } else if (payload.generatorSource) {
      lines.push(`<div class="line">Likely generator: ${esc(payload.generatorSource)}</div>`);
    }
    if (payload.contextLine) {
      lines.push(`<div class="line">💬 ${esc(payload.contextLine)}</div>`);
    }
    if (payload.contentCredentialsLine) {
      lines.push(`<div class="line">📜 ${esc(payload.contentCredentialsLine)}</div>`);
    }
    if (payload.lensUrl && /^https:\/\/lens\.google\.com\//.test(payload.lensUrl)) {
      lines.push(
        `<a class="lens" href="${esc(payload.lensUrl)}" target="_blank" rel="noopener noreferrer">Search this image on Google Lens</a>`,
      );
    }
    if (payload.evidenceRef) {
      lines.push(`<div class="muted">Evidence ref: ${esc(payload.evidenceRef)}</div>`);
    }
    if (payload.evidenceUrl && /^https:\/\/askarthur\.au\//.test(payload.evidenceUrl)) {
      lines.push(
        `<a class="lens" href="${esc(payload.evidenceUrl)}" target="_blank" rel="noopener noreferrer">View evidence report</a>`,
      );
    }
    if (payload.disclaimer) {
      lines.push(`<div class="muted">${esc(payload.disclaimer)}</div>`);
    }
    if (payload.checksRemaining !== null && payload.checksRemaining !== undefined) {
      lines.push(`<div class="muted">${payload.checksRemaining} image checks left today</div>`);
    }
    body = lines.join("");
  }

  shadow.innerHTML = `
    ${baseStyle}
    <div class="card">
      <div class="head">
        <span class="brand">ASK ARTHUR — IMAGE CHECK</span>
        <button class="close" aria-label="Dismiss">✕</button>
      </div>
      ${body}
    </div>`;

  shadow.querySelector(".close")?.addEventListener("click", () => {
    host?.remove();
  });
}
