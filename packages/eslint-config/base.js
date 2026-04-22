// Shared ESLint flat-config base for the ask-arthur monorepo.
// Consumers: `packages/eslint-config/{next,react,node}.js` compose on top of this.

// The sanctioned unused-vars rule. Explicit `args: "all"` + `caughtErrors: "all"`
// is load-bearing: without them, the corresponding *IgnorePattern options are
// silently dropped (typescript-eslint#8464). Identifiers prefixed with `_` are
// always treated as intentionally unused.
const unusedVars = [
  "warn",
  {
    args: "all",
    argsIgnorePattern: "^_",
    caughtErrors: "all",
    caughtErrorsIgnorePattern: "^_",
    destructuredArrayIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    ignoreRestSiblings: true,
  },
];

export const baseRules = {
  "@typescript-eslint/no-unused-vars": unusedVars,
};

export const baseIgnores = {
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.expo/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/build/**",
    "**/out/**",
    "**/*.min.js",
    "**/next-env.d.ts",
  ],
};

// Default export: plain config array for non-Next consumers that want just the
// shared ignores + unused-vars rule. Next.js consumers should import `./next`
// which layers eslint-config-next's type-aware rules on top.
const base = [
  baseIgnores,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: baseRules,
  },
];

export default base;
