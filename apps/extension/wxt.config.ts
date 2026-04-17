import { defineConfig } from "wxt";

const urlGuardEnabled = process.env.WXT_URL_GUARD === "true";
const extensionSecurityEnabled = process.env.WXT_EXTENSION_SECURITY !== "false";
const facebookAdsEnabled = process.env.WXT_FACEBOOK_ADS === "true";
const siteAuditEnabled = process.env.WXT_SITE_AUDIT === "true";
const turnstileBridgeUrl =
  process.env.WXT_TURNSTILE_BRIDGE_URL ??
  "https://askarthur.au/extension-turnstile";

// WXT 0.20.x: `filterEntrypoints` is an INCLUSION list of entrypoint names
// (file stem without `.content` suffix). Anything not listed is skipped.
// Background + popup + offscreen (for the Turnstile bot-gate) are always
// included; content scripts are gated on flags.
const includedEntrypoints: string[] = ["background", "popup", "offscreen"];

if (urlGuardEnabled) {
  includedEntrypoints.push("url-guard");
}

if (facebookAdsEnabled) {
  includedEntrypoints.push("facebook-ads", "facebook-marketplace");
}

if (siteAuditEnabled) {
  includedEntrypoints.push("site-audit");
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "dist",
  filterEntrypoints: includedEntrypoints,
  manifest: {
    name: "Ask Arthur — Scam Detector",
    description:
      "Check URLs and suspicious messages for scams with AI-powered analysis. Free, no account required.",
    version: "1.0.0",
    permissions: [
      "activeTab",
      "contextMenus",
      "storage",
      "offscreen",
      ...(urlGuardEnabled ? ["webNavigation" as const] : []),
      ...(extensionSecurityEnabled ? ["alarms" as const] : []),
    ],
    optional_permissions: [
      ...(extensionSecurityEnabled ? ["management" as const] : []),
    ],
    host_permissions: [
      "https://askarthur.au/api/extension/*",
      ...(urlGuardEnabled ? ["<all_urls>" as const] : []),
      ...(facebookAdsEnabled ? [
        "https://www.facebook.com/*" as const,
        "https://m.facebook.com/*" as const,
        "https://web.facebook.com/*" as const,
      ] : []),
    ],
    icons: {
      "16": "icon/16.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
    // Firefox Add-ons Store requirements (C3)
    browser_specific_settings: {
      gecko: {
        id: "arthur@askarthur.au",
        strict_min_version: "109.0",
      },
    },
  },
  vite: () => ({
    define: {
      __EXTENSION_SECRET__: JSON.stringify(
        process.env.WXT_EXTENSION_SECRET ?? ""
      ),
      __TURNSTILE_BRIDGE_URL__: JSON.stringify(turnstileBridgeUrl),
      __URL_GUARD_ENABLED__: urlGuardEnabled,
      __EXTENSION_SECURITY_ENABLED__: extensionSecurityEnabled,
      __FACEBOOK_ADS_ENABLED__: facebookAdsEnabled,
    },
  }),
});
