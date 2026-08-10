// Architectural fitness functions for the package graph (ADR-0024).
// Run via `pnpm boundaries`. Graph-level rules live here; import-specifier
// rules (deep imports, wrong scope) live in packages/eslint-config/base.js.
//
// Ratchet protocol: a rule with live violations starts at "warn" (exit 0, CI
// stays green) and is listed in docs/refactor-backlog.md. The backlog item
// that clears the last violation flips the rule to "error" in the same PR.

module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "\\.(test|spec)\\.[jt]sx?$",
        "__tests__",
        "__mocks__",
        "\\.next/",
        "\\.expo/",
        "\\.output/",
        "\\.wxt/",
        // Workspace build outputs only — a bare "/dist/" would also swallow
        // node_modules resolutions like next-axiom/dist/index.js and silently
        // blind the packages-no-next rule.
        "^(apps|packages)/[^/]+/(dist|coverage)/",
        // Tooling, not domain: lint config files import the shared eslint-config
        // package by design and must not trip graph rules.
        "eslint\\.config\\.(mjs|cjs|js)$",
        "^packages/eslint-config/",
      ],
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "types", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
  forbidden: [
    {
      name: "packages-no-next",
      severity: "warn", // ratchet: flips to error when packages/utils/src/axiom-logger.ts moves to apps/web (refactor backlog #2)
      comment:
        "Domain packages stay framework-free. packages/supabase is the sanctioned Next runtime adapter (ADR-0024).",
      from: { path: "^packages/", pathNot: "^packages/supabase/" },
      // Not ^-anchored: pnpm resolves to node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>/.
      to: { path: "node_modules/(next|next-axiom)/" },
    },
    {
      name: "packages-not-to-apps",
      severity: "error",
      comment: "Dependencies point from adapters (apps) toward domain modules (packages), never back.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-not-to-apps",
      severity: "error",
      comment: "Apps are independent adapters; shared behavior belongs in a package.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "types-is-a-leaf",
      severity: "error",
      comment: "@askarthur/types sits at the bottom of the graph and imports from no other workspace.",
      from: { path: "^packages/types/" },
      to: { path: "^packages/", pathNot: "^packages/types/" },
    },
    {
      name: "no-circular",
      severity: "warn", // baseline unknown at adoption; ratchet to error once measured clean
      comment: "Circular dependencies make modules impossible to reason about or extract.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-undeclared-deps",
      severity: "warn", // known violation: packages/supabase uses next without declaring it (refactor backlog #3)
      comment:
        "Imports must be declared in the workspace's own package.json — phantom deps ride on pnpm hoisting accidents.",
      from: { path: "^(apps|packages)/" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
};
