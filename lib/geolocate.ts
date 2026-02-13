// Geolocate IP to region string (city, state/country)
// Uses free ip-api.com service. IP is sent for lookup but NEVER stored.

export interface GeoResult {
  region: string | null;
  countryCode: string | null;
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
