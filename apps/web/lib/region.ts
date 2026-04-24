import "server-only";

// Region detection for the Phone Footprint surface.
//
// Reads Vercel's edge-injected `x-vercel-ip-country` header to determine
// where the caller is geographically. Used for:
//   - Surfacing accurate "is SIM swap available in your country?" copy
//   - Selecting the correct currency for Stripe checkout (Sprint 7)
//   - Per-jurisdiction privacy disclosures (Sprint 8)
//
// In dev (no Vercel headers) returns null and callers should fall back
// to a country-agnostic UI rather than guessing.

import type { NextRequest } from "next/server";

/**
 * Vonage CAMARA SIM Swap + Device Swap country coverage as of April 2026.
 * Source: vonage.com/communications-apis/identity-insights — only these
 * countries are in their Network Registry country picker today. AU, JP,
 * IN, ZA, etc. are NOT in this list. Update when Vonage expands.
 */
export const VONAGE_CAMARA_COUNTRIES = new Set<string>([
  "DE", // Germany
  "IT", // Italy
  "US", // United States
  "GB", // United Kingdom
  "BR", // Brazil
  "ES", // Spain
  "FR", // France
  "NL", // Netherlands
  "CA", // Canada
]);

/**
 * Countries where carrier-drift detection (our Twilio-Lookup-based fallback
 * for pillar 4) is the best available SIM-swap proxy. Currently AU + every
 * country NOT in VONAGE_CAMARA_COUNTRIES. Once Telstra direct lands, AU
 * will move to a stronger signal and drop from this list.
 */
export function isSimSwapAvailableInCountry(country: string | null): boolean {
  if (!country) return false;
  return VONAGE_CAMARA_COUNTRIES.has(country.toUpperCase());
}

/**
 * Read Vercel's geo header. Returns the ISO 3166-1 alpha-2 country code
 * (e.g., "AU", "GB", "US") or null if Vercel hasn't injected it (dev,
 * misconfigured proxy, etc.).
 */
export function getCallerCountry(req: NextRequest | Request): string | null {
  // NextRequest typings expose .headers; Request does too. Same call.
  const country = req.headers.get("x-vercel-ip-country");
  if (!country) return null;
  // Normalise: header values arrive as already-uppercase 2-letter codes,
  // but defensive uppercasing costs nothing.
  return country.toUpperCase();
}

/**
 * Compose a "what coverage do you get?" object for the lookup response.
 * The UI uses this to render region-aware copy ("SIM swap detection
 * available for your country" vs "carrier activity monitoring — full
 * SIM swap coming when your carriers join Open Gateway").
 */
export interface RegionalCoverage {
  caller_country: string | null;
  sim_swap_carrier_authoritative: boolean;
  sim_swap_signal: "vonage_camara" | "carrier_drift" | "none";
}

export function describeRegionalCoverage(
  country: string | null,
): RegionalCoverage {
  if (!country) {
    return {
      caller_country: null,
      sim_swap_carrier_authoritative: false,
      sim_swap_signal: "carrier_drift",
    };
  }
  if (isSimSwapAvailableInCountry(country)) {
    return {
      caller_country: country,
      sim_swap_carrier_authoritative: true,
      sim_swap_signal: "vonage_camara",
    };
  }
  return {
    caller_country: country,
    sim_swap_carrier_authoritative: false,
    sim_swap_signal: "carrier_drift",
  };
}
