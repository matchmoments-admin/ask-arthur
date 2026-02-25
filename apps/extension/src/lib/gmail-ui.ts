import type { EmailScanResult } from "@askarthur/types";
import type { Verdict } from "@askarthur/types";

const VERDICT_STYLES: Record<Verdict, { bg: string; border: string; icon: string; title: string }> = {
  SAFE: {
    bg: "#E8F5E9",
    border: "#388E3C",
    icon: "&#x2705;", // checkmark
    title: "This Email Appears Safe",
  },
  SUSPICIOUS: {
    bg: "#FFF3E0",
    border: "#F57C00",
    icon: "&#x26A0;&#xFE0F;", // warning
    title: "Proceed with Caution",
  },
  HIGH_RISK: {
    bg: "#FFEBEE",
    border: "#D32F2F",
    icon: "&#x1F6A8;", // rotating light
    title: "High Risk — Likely a Scam",
  },
};

const BANNER_STYLES = `
  :host {
    all: initial;
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0 0 8px 0;
  }
  .arthur-banner {
    border-radius: 8px;
    padding: 12px 16px;
    line-height: 1.4;
  }
  .arthur-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .arthur-icon {
    font-size: 18px;
    flex-shrink: 0;
  }
  .arthur-title {
    font-weight: 600;
    font-size: 14px;
    margin: 0;
    color: #1a1a1a;
  }
  .arthur-confidence {
    font-size: 12px;
    color: #666;
    margin-left: auto;
    flex-shrink: 0;
  }
  .arthur-summary {
    font-size: 13px;
    color: #333;
    margin: 4px 0 0 0;
  }
  .arthur-details {
    margin-top: 8px;
    font-size: 12px;
    color: #444;
  }
  .arthur-details summary {
    cursor: pointer;
    font-weight: 500;
    color: #333;
    user-select: none;
  }
  .arthur-list {
    margin: 4px 0 0 0;
    padding-left: 20px;
  }
  .arthur-list li {
    margin: 2px 0;
  }
  .arthur-section-title {
    font-weight: 600;
    font-size: 12px;
    margin: 8px 0 2px 0;
    color: #555;
  }
  .arthur-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .arthur-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background: white;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .arthur-btn:hover {
    background: #f5f5f5;
  }
  .arthur-btn-report {
    border-color: #D32F2F;
    color: #D32F2F;
  }
  .arthur-btn-report:hover {
    background: #FFEBEE;
  }
  .arthur-btn-dismiss {
    color: #666;
  }
  .arthur-scanning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #E3F2FD;
    border-left: 3px solid #1976D2;
    border-radius: 8px;
    font-size: 13px;
    color: #1565C0;
  }
  .arthur-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #90CAF9;
    border-top-color: #1976D2;
    border-radius: 50%;
    animation: arthur-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes arthur-spin {
    to { transform: rotate(360deg); }
  }
  .arthur-branding {
    font-size: 10px;
    color: #999;
    margin-top: 6px;
  }
`;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function createScanningBanner(): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-email-banner";
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>${BANNER_STYLES}</style>
    <div class="arthur-scanning">
      <div class="arthur-spinner"></div>
      <span>Arthur is checking this email...</span>
    </div>
  `;

  return host;
}

export function createVerdictBanner(
  result: EmailScanResult,
  onReport?: () => void,
  onDismiss?: () => void
): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-email-banner";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = VERDICT_STYLES[result.verdict];
  const showReport = result.verdict !== "SAFE";

  const redFlagsHtml = result.redFlags.length > 0
    ? `
      <div class="arthur-section-title">What We Found</div>
      <ul class="arthur-list">
        ${result.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
      </ul>
    ` : "";

  const nextStepsHtml = result.nextSteps.length > 0
    ? `
      <div class="arthur-section-title">What To Do</div>
      <ul class="arthur-list">
        ${result.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
      </ul>
    ` : "";

  const detailsHtml = (result.redFlags.length > 0 || result.nextSteps.length > 0)
    ? `
      <details class="arthur-details">
        <summary>Details</summary>
        ${redFlagsHtml}
        ${nextStepsHtml}
      </details>
    ` : "";

  shadow.innerHTML = `
    <style>${BANNER_STYLES}</style>
    <div class="arthur-banner" style="background:${style.bg};border-left:3px solid ${style.border}">
      <div class="arthur-header">
        <span class="arthur-icon">${style.icon}</span>
        <h3 class="arthur-title">${escapeHtml(style.title)}</h3>
        <span class="arthur-confidence">${result.confidence}% confidence</span>
      </div>
      <p class="arthur-summary">${escapeHtml(result.summary)}</p>
      ${detailsHtml}
      <div class="arthur-actions">
        ${showReport ? '<button class="arthur-btn arthur-btn-report" data-action="report">Report as Scam</button>' : ""}
        <button class="arthur-btn arthur-btn-dismiss" data-action="dismiss">Dismiss</button>
      </div>
      <div class="arthur-branding">Checked by Ask Arthur</div>
    </div>
  `;

  // Attach event handlers
  const reportBtn = shadow.querySelector('[data-action="report"]');
  if (reportBtn && onReport) {
    reportBtn.addEventListener("click", onReport);
  }

  const dismissBtn = shadow.querySelector('[data-action="dismiss"]');
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      host.remove();
      onDismiss?.();
    });
  }

  return host;
}

export function replaceBanner(
  container: HTMLElement,
  oldBanner: HTMLElement,
  newBanner: HTMLElement
): void {
  if (oldBanner.parentElement === container) {
    container.replaceChild(newBanner, oldBanner);
  } else {
    container.prepend(newBanner);
  }
}
