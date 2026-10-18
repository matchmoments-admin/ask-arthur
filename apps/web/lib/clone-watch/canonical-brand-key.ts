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
  return brandNormalize(typeof canonical === "string" && canonical ? canonical : rawName);
}
