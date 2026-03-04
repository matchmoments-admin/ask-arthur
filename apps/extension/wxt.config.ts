import { defineConfig } from "wxt";

const urlGuardEnabled = process.env.WXT_URL_GUARD === "true";
const extensionSecurityEnabled = process.env.WXT_EXTENSION_SECURITY !== "false";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "Ask Arthur — Scam Detector",
    description:
      "Check URLs and suspicious messages for scams with AI-powered analysis. Free, no account required.",
    version: "1.0.0",
    permissions: [
      "activeTab",
      "contextMenus",
      "storage",
      ...(urlGuardEnabled ? ["webNavigation" as const] : []),
      ...(extensionSecurityEnabled ? ["alarms" as const] : []),
    ],
    optional_permissions: [
      ...(extensionSecurityEnabled ? ["management" as const] : []),
    ],
    host_permissions: [
      "https://askarthur.au/api/extension/*",
      ...(urlGuardEnabled ? ["<all_urls>" as const] : []),
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
      __URL_GUARD_ENABLED__: urlGuardEnabled,
      __EXTENSION_SECURITY_ENABLED__: extensionSecurityEnabled,
    },
  }),
});
