// Offscreen document: hosts an iframe on askarthur.au that renders Cloudflare
// Turnstile, then relays the token back to the background service worker via
// chrome.runtime.sendMessage. This exists because Turnstile rejects
// chrome-extension:// origins directly; serving the widget from our own domain
// is the supported workaround.

declare const __TURNSTILE_BRIDGE_URL__: string;

const iframe = document.getElementById("turnstile-frame") as HTMLIFrameElement | null;
if (iframe) {
  iframe.src = __TURNSTILE_BRIDGE_URL__;
}

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  const data = event.data as { type?: string; token?: string; reason?: string };

  if (data.type === "turnstile-token" && typeof data.token === "string") {
    chrome.runtime.sendMessage({
      type: "askarthur-turnstile-token",
      token: data.token,
    });
  } else if (data.type === "turnstile-error") {
    chrome.runtime.sendMessage({
      type: "askarthur-turnstile-error",
      reason: data.reason ?? "unknown",
    });
  }
});
