import { brandNormalize } from "@askarthur/shopfront-glue";
import type { createServiceClient } from "@askarthur/supabase/server";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * The ONE way a Brand Subscriber's key is derived (ADR-0020, #1295): resolve
 * the typed name through the brand_aliases layer (`resolve_brand`), then
 * `brand_normalize` the canonical label — falling back to the raw name when no
 * alias matches. Checkout AND admin onboarding call this, so the same brand
 * can never become two rows ("CBA" vs "Commonwealth Bank").
 *
 * An alias read failure only weakens canonicalisation (falls back to the raw
 * name), the same posture as loadAliasRecord. Returns null when the name has
 * no letters or digits.
 */
export async function canonicalBrandKey(
  sb: ServiceClient,
  rawName: string,
): Promise<string | null> {
  const { data: canonical } = await sb.rpc("resolve_brand", { p_raw: rawName });
  return keyOf(typeof canonical === "string" ? canonical : null, rawName);
}

/** The rule itself: brand_normalize(canonical label ?? raw name). The SQL
 *  twin is `brand_normalize(COALESCE(resolve_brand(x), x))` (v347 checkout
 *  keying, v348 seed matching). */
function keyOf(canonical: string | null | undefined, rawName: string | null | undefined): string | null {
  return brandNormalize(canonical ? canonical : (rawName ?? ""));
}

/**
 * The same key, for a caller that keys MANY names in one run (#1304,
 * known-brands-discover): resolves through a bulk-loaded alias record
 * (buildBrandResolver over loadAliasRecord) instead of one `resolve_brand`
 * round trip per name. Same rule as canonicalBrandKey — one key function,
 * two ways to feed it the alias layer.
 */
export function canonicalBrandKeyResolver(
  resolve: (raw: string | null | undefined) => string | null,
): (raw: string | null | undefined) => string | null {
  return (raw) => keyOf(resolve(raw), raw);
}
