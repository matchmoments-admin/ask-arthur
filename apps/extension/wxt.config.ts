import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "Ask Arthur — Scam Detector",
    description:
      "Check URLs and suspicious messages for scams with AI-powered analysis. Free, no account required.",
    version: "1.0.0",
    permissions: ["activeTab", "contextMenus", "storage"],
    host_permissions: ["https://askarthur.au/api/extension/*"],
    icons: {
      "16": "icon/16.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
  },
  vite: () => ({
    define: {
      __EXTENSION_SECRET__: JSON.stringify(
        process.env.WXT_EXTENSION_SECRET ?? ""
      ),
    },
  }),
});
