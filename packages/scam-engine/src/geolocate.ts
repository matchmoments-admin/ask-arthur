// Geolocation helpers.
//
// - `geolocateFromHeaders` reads Vercel's edge-set `x-vercel-ip-*` headers.
//   Zero latency, zero external dependency, cannot be spoofed by origin
//   traffic. Use this on the request path — it replaces the former ip-api.com
//   call which added a blocking HTTP hop and could be stripped by any
//   upstream proxy.
//
// - `geolocateIP` is retained for background jobs (Inngest enrichment) where
//   no Request is available and only a raw IP is known. IP is sent to
//   ip-api.com but NEVER stored.

export interface GeoResult {
  region: string | null;
  countryCode: string | null;
}

/**
 * Read geolocation from Vercel edge request headers. Synchronous, no I/O.
 * Prefer this over {@link geolocateIP} anywhere a Request/Headers object is
 * available.
 *
 * Vercel sets `x-vercel-ip-city` URL-encoded per their docs; we decode.
 */
export function geolocateFromHeaders(headers: Headers): GeoResult {
  const countryCode = headers.get("x-vercel-ip-country") || null;
  const rawCity = headers.get("x-vercel-ip-city");
  const regionName = headers.get("x-vercel-ip-country-region");

  let city: string | null = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }

  let region: string | null = null;
  if (city && regionName) {
    region = `${city}, ${regionName}`;
  } else if (countryCode) {
    region = countryCode;
  }

  return { region, countryCode };
}

export async function geolocateIP(ip: string): Promise<GeoResult> {
  try {
    // Skip private/localhost IPs
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.")
    ) {
      return { region: null, countryCode: null };
    }

    const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country,countryCode`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return { region: null, countryCode: null };

    const data = await res.json();
    let region: string | null = null;
    if (data.city && data.regionName) {
      region = `${data.city}, ${data.regionName}`;
    } else if (data.country) {
      region = data.country;
    }
    return { region, countryCode: data.countryCode || null };
  } catch {
    return { region: null, countryCode: null };
  }
}
