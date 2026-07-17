import { defineConfig } from "vitest/config";
import path from "path";

// jsdom because the units under test (ad-detector, marketplace-detector) are
// pure DOM logic exercised against saved Facebook HTML fixtures — see
// test/fixtures/facebook/ and docs/ops/extension-fixture-refresh.md.
// WXT entrypoints (defineContentScript etc.) are NOT importable here; only
// src/lib/ modules are under test.
export default defineConfig({
  test: {
    environment: "jsdom",
    // Content scripts run on facebook.com, and relative hrefs (Facebook's
    // fragmented-span label uses href="#") must resolve against a facebook
    // origin — with jsdom's default localhost base they would masquerade as
    // external landing URLs.
    environmentOptions: { jsdom: { url: "https://www.facebook.com/" } },
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
