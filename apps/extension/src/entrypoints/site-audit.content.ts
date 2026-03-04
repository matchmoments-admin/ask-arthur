import type { MessageResponse } from "@/lib/types";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    // Listen for site audit requests from background/popup
    chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse: (response: MessageResponse) => void) => {
        if (message.type !== "COLLECT_PAGE_DATA") return false;

        const pageData = collectPageSecurityData();
        sendResponse({ success: true, data: pageData });
        return false;
      }
    );
  },
});

interface PageSecurityData {
  url: string;
  forms: FormInfo[];
  externalScripts: string[];
  mixedContent: boolean;
  hasServiceWorker: boolean;
  iframeCount: number;
  metaTags: Record<string, string>;
}

interface FormInfo {
  action: string;
  method: string;
  hasPasswordField: boolean;
  isSecure: boolean;
}

function collectPageSecurityData(): PageSecurityData {
  const url = window.location.href;

  // Collect form information
  const forms: FormInfo[] = Array.from(document.forms).map((form) => ({
    action: form.action || url,
    method: (form.method || "GET").toUpperCase(),
    hasPasswordField: !!form.querySelector('input[type="password"]'),
    isSecure: (form.action || url).startsWith("https://"),
  }));

  // Collect external scripts
  const externalScripts = Array.from(document.querySelectorAll("script[src]"))
    .map((el) => (el as HTMLScriptElement).src)
    .filter((src) => {
      try {
        return new URL(src).origin !== window.location.origin;
      } catch {
        return false;
      }
    });

  // Check for mixed content
  const mixedContent =
    window.location.protocol === "https:" &&
    Array.from(document.querySelectorAll("img, script, link, iframe")).some(
      (el) => {
        const src =
          (el as HTMLImageElement).src ||
          (el as HTMLLinkElement).href ||
          "";
        return src.startsWith("http://");
      }
    );

  // Check for service workers
  const hasServiceWorker = "serviceWorker" in navigator;

  // Count iframes
  const iframeCount = document.querySelectorAll("iframe").length;

  // Collect security-relevant meta tags
  const metaTags: Record<string, string> = {};
  document
    .querySelectorAll('meta[http-equiv], meta[name*="csrf"], meta[name*="referrer"]')
    .forEach((el) => {
      const name =
        (el as HTMLMetaElement).httpEquiv ||
        (el as HTMLMetaElement).name;
      const content = (el as HTMLMetaElement).content;
      if (name && content) {
        metaTags[name] = content;
      }
    });

  return {
    url,
    forms,
    externalScripts,
    mixedContent,
    hasServiceWorker,
    iframeCount,
    metaTags,
  };
}
