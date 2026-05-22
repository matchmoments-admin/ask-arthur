import { defineConfig } from "vitest/config";

// The commerce detector reads the DOM, so tests need a document.
// Scoped to *.test.ts under src/ — entrypoints are bundled by WXT, not
// vitest.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
