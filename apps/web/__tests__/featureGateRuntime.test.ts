import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A route-level feature gate has to be evaluated per REQUEST.
 *
 * gateOrNotFound()/gateOrRedirect() run inside a Server Component. On a
 * statically prerendered route that means they run ONCE, at build time, and the
 * verdict is baked into HTML — so the page keeps serving 200 after the flag is
 * turned off, and keeps 404ing after it is turned on, until something triggers a
 * rebuild. Vercel env changes frequently do NOT trigger one (the ignore-step
 * `[build]` trap), so the skew persists indefinitely.
 *
 * Measured 2026-07-30: 6 of 8 gated routes had no `dynamic` export, and
 * /charity-check was serving HTTP 200 while POST /api/charity-check and
 * GET /api/charity-check/autocomplete both returned 503 feature_disabled — a
 * live page where every search a user ran failed. Same flag, different
 * evaluation time.
 *
 * This test is the enforcement. It fails the build if a route imports a gate
 * helper without opting out of static rendering.
 */

const APP_DIR = join(__dirname, "..", "app");
const GATE_HELPERS = ["gateOrNotFound", "gateOrRedirect"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry === "page.tsx" || entry === "layout.tsx") {
      out.push(full);
    }
  }
  return out;
}

/** Routes that call a gate helper, with their source. */
function gatedRoutes(): { file: string; src: string }[] {
  return walk(APP_DIR)
    .map((file) => ({ file, src: readFileSync(file, "utf8") }))
    .filter(({ src }) => GATE_HELPERS.some((h) => src.includes(`${h}(`)));
}

describe("route-level feature gates are evaluated at request time", () => {
  it("finds the gated routes at all (guards against the walk silently breaking)", () => {
    // If this drops to 0 the test below passes vacuously — the exact shape of
    // failure this whole audit kept finding.
    expect(gatedRoutes().length).toBeGreaterThanOrEqual(6);
  });

  it("every gated route opts out of static prerendering", () => {
    const offenders = gatedRoutes()
      .filter(({ src }) => {
        const forcedDynamic = /export const dynamic\s*=\s*["']force-dynamic["']/.test(src);
        const noRevalidate = /export const revalidate\s*=\s*0\b/.test(src);
        return !forcedDynamic && !noRevalidate;
      })
      .map(({ file }) => file.replace(`${APP_DIR}/`, "app/"));

    expect(
      offenders,
      `These routes call gateOrNotFound()/gateOrRedirect() but are statically ` +
        `prerendered, so the flag is evaluated at BUILD time and the verdict is ` +
        `baked in. Add:\n\n  export const dynamic = "force-dynamic";\n\n` +
        `Offenders:\n${offenders.map((o) => `  - ${o}`).join("\n")}`,
    ).toEqual([]);
  });
});
