// Flat-config for pure Node / TypeScript packages (bot-core, utils, etc.).
// Registers the typescript-eslint parser + plugin that baseRules'
// @typescript-eslint/no-unused-vars needs (Next.js consumers get these via
// eslint-config-next instead). Deliberately does NOT extend
// tseslint.configs.recommended — packages adopting lint for the first time
// get the shared conventions only; the recommended set can be layered
// per-package once the baseline is green.

import tseslint from "typescript-eslint";
import { baseIgnores, baseRules } from "./base.js";

export default [
  baseIgnores,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: baseRules,
  },
];
