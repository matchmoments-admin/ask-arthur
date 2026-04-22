// Root flat-config entry. ESLint 9 requires a config at the directory it's
// invoked from (lint-staged runs from the monorepo root), but each app and
// package already ships its own flat config layered on @askarthur/eslint-config.
// Rather than re-derive a root ruleset, this file punts linting entirely to
// those nested configs by ignoring every source tree with its own config.
//
// To lint a workspace, run eslint from inside it (or `pnpm turbo lint`).

export default [
  {
    ignores: [
      "apps/**",
      "packages/**",
      "tooling/**",
      "pipeline/**",
      "supabase/**",
      "docs/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
    ],
  },
];
