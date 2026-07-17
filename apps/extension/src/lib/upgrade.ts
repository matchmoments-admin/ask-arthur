import type { MessageResponse } from "./types";

declare const __EXTENSION_BILLING_ENABLED__: boolean;
declare const __WEB_APP_BASE__: string;

/**
 * Open the right upgrade surface for this build. With billing enabled, mint
 * a link token (background holds the keys) and open /extension/link — the
 * page links the install and shows the Pro checkout. Without it (or if the
 * mint fails, e.g. server flag off), fall back to the public pricing page
 * so the CTA is never a dead end.
 */
export async function openUpgradePage(ref: string): Promise<void> {
  const billingEnabled =
    typeof __EXTENSION_BILLING_ENABLED__ !== "undefined" &&
    __EXTENSION_BILLING_ENABLED__;

  if (billingEnabled) {
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "MINT_LINK_TOKEN",
      })) as MessageResponse<{ token: string }>;
      if (res.success && res.data?.token) {
        await chrome.tabs.create({
          url: `${__WEB_APP_BASE__}/extension/link?token=${encodeURIComponent(res.data.token)}&ref=${encodeURIComponent(ref)}`,
        });
        return;
      }
    } catch {
      // Fall through to pricing.
    }
  }

  await chrome.tabs.create({
    url: `${__WEB_APP_BASE__}/pricing?ref=${encodeURIComponent(ref)}`,
  });
}
