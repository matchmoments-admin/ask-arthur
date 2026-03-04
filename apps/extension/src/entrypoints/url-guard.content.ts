import type { ShowPhishingWarningMessage } from "@/lib/types";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    chrome.runtime.onMessage.addListener(
      (message: ShowPhishingWarningMessage) => {
        if (message.type !== "SHOW_PHISHING_WARNING") return;

        showWarningOverlay(message);
      }
    );
  },
});

function showWarningOverlay(warning: ShowPhishingWarningMessage) {
  // Prevent duplicate overlays
  if (document.getElementById("arthur-phishing-overlay")) return;

  // Create shadow DOM host for style isolation
  const host = document.createElement("div");
  host.id = "arthur-phishing-overlay";
  host.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;";

  const shadow = host.attachShadow({ mode: "closed" });

  const isHigh = warning.threatLevel === "HIGH";
  const borderColor = isHigh ? "#D32F2F" : "#F57C00";
  const bgColor = isHigh ? "#FFF5F5" : "#FFFBF0";
  const iconColor = isHigh ? "#D32F2F" : "#F57C00";
  const label = isHigh ? "High Risk" : "Suspicious";

  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .overlay {
        position: fixed; top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .card {
        background: ${bgColor};
        border: 3px solid ${borderColor};
        border-radius: 16px;
        max-width: 480px;
        width: 90%;
        padding: 32px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .icon { font-size: 48px; margin-bottom: 16px; }
      .title {
        font-size: 22px; font-weight: 700;
        color: ${iconColor};
        margin-bottom: 8px;
      }
      .domain {
        font-size: 14px; color: #333;
        word-break: break-all;
        margin-bottom: 12px;
        padding: 8px 12px;
        background: rgba(0,0,0,0.05);
        border-radius: 8px;
        font-family: monospace;
      }
      .meta {
        font-size: 13px; color: #666;
        margin-bottom: 24px;
      }
      .btn-back {
        display: inline-block;
        background: ${iconColor};
        color: white;
        border: none;
        padding: 12px 32px;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        margin-bottom: 12px;
        width: 100%;
      }
      .btn-back:hover { opacity: 0.9; }
      .btn-continue {
        display: inline-block;
        background: transparent;
        color: #999;
        border: 1px solid #ddd;
        padding: 8px 24px;
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
        width: 100%;
      }
      .btn-continue:hover { color: #666; border-color: #bbb; }
      .badge {
        display: inline-block;
        background: ${iconColor};
        color: white;
        padding: 2px 10px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 16px;
      }
    </style>
    <div class="overlay">
      <div class="card">
        <div class="icon">${isHigh ? "\uD83D\uDED1" : "\u26A0\uFE0F"}</div>
        <span class="badge">${label}</span>
        <h2 class="title">Warning: Potential Scam Site</h2>
        <div class="domain">${escapeHtml(warning.domain)}</div>
        <p class="meta">
          This website has been flagged as potentially dangerous.
          ${warning.reportCount ? `Reported ${warning.reportCount} time${warning.reportCount > 1 ? "s" : ""}.` : ""}
        </p>
        <button class="btn-back" id="arthur-go-back">Go Back to Safety</button>
        <button class="btn-continue" id="arthur-continue">I understand the risks, continue</button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(host);

  // Button handlers
  shadow.getElementById("arthur-go-back")?.addEventListener("click", () => {
    history.back();
    // If no history, close the tab
    setTimeout(() => host.remove(), 200);
  });

  shadow.getElementById("arthur-continue")?.addEventListener("click", () => {
    host.remove();
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
