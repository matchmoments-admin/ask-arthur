// Feature-flag route gates for Server Components.
//
// Replaces inline `if (!featureFlags.X) notFound()` / `redirect(...)` blocks
// in RSC pages with two typed helpers. Concentrates the "flag → 404 / redirect"
// decision in one place so the flag-off path is testable and the audit
// surface ("which routes are behind which flag") is greppable.
//
// Out of scope: inline-JSX gates like `{featureFlags.X && <Panel />}` — that's
// a partial render, not a route gate. Leave those alone.
//
// Out of scope: the `app/app/layout.tsx` tenancy check — it's
// `featureFlags.multiTenancy && !org`, which combines a flag with org state.
// Not a pure route gate.
//
// ⚠ CALLERS MUST OPT OUT OF STATIC PRERENDERING:
//
//     export const dynamic = "force-dynamic";
//
// These helpers run inside a Server Component, so on a statically prerendered
// route they are evaluated ONCE at build time and the verdict is baked into
// HTML. The page then keeps serving 200 after the flag is turned off, and keeps
// 404ing after it is turned on, until something triggers a rebuild — and Vercel
// env changes frequently do not trigger one.
//
// Measured 2026-07-30: 6 of 8 gated routes were missing the export, and
// /charity-check was serving HTTP 200 while both of its API routes returned 503
// feature_disabled off the SAME flag. Every search a user ran on that page
// failed. The difference was purely build-time vs request-time evaluation.
//
// Enforced by apps/web/__tests__/featureGateRuntime.test.ts — that test fails
// the build if a gated route is statically prerendered, so this comment is a
// pointer to the check rather than a promise on its own.

import "server-only";

import { notFound, redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";

/**
 * Throw `NEXT_NOT_FOUND` (Next.js 404 response) when the named flag is off.
 *
 * Use this for routes that should appear nonexistent when disabled — public
 * consumer surfaces gated behind a launch flag, intel deep-links behind
 * `redditIntelPublicPages`, etc.
 *
 * Returns `void` but its call-site behaves as `never` because `notFound()`
 * throws — TypeScript's narrowing picks this up correctly.
 */
export function gateOrNotFound(flag: keyof typeof featureFlags): void {
  if (!featureFlags[flag]) notFound();
}

/**
 * Throw `NEXT_REDIRECT` to `to` when the named flag is off.
 *
 * Use this for routes that should bounce to a known destination when
 * disabled — billing → `/app`, auth pages → `/` when auth is off, etc.
 */
export function gateOrRedirect(
  flag: keyof typeof featureFlags,
  to: string,
): void {
  if (!featureFlags[flag]) redirect(to);
}
