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

// Interface-discipline rules (ADR-0024). All three patterns have zero
// violations in the repo, so they start at "error" — they are a ratchet
// against regressions, not a cleanup burden.
const restrictedImports = [
  "error",
  {
    patterns: [
      {
        group: ["@askarthur/*/src", "@askarthur/*/src/*"],
        message:
          "Deep import bypasses the package's interface. Import the entry point or a subpath export declared in its package.json.",
      },
      {
        group: ["@ask-arthur/*"],
        message: "Wrong scope — the workspace scope is @askarthur/* (no hyphen).",
      },
      {
        group: ["**/../packages/**", "**/../apps/**"],
        message:
          "Relative path into another workspace. Use the @askarthur/* workspace specifier instead.",
      },
    ],
  },
];

export const baseRules = {
  "@typescript-eslint/no-unused-vars": unusedVars,
  "no-restricted-imports": restrictedImports,
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
    "**/.output/**",
    "**/.wxt/**",
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
