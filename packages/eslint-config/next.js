// Flat-config bundle for Next.js apps in the ask-arthur monorepo.
// Layers eslint-config-next's core-web-vitals + typescript presets on top of
// the shared base (unused-vars with `_` ignore patterns, shared ignore globs).

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";
import { baseRules } from "./base.js";

const nextConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: baseRules,
  },
  // eslint-config-next's default ignores already cover .next/**; we list them
  // again here so per-package configs don't have to redeclare them.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default nextConfig;
