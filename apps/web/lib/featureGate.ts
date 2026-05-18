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
