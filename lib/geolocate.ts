// Geolocate IP to region string (city, state/country)
// Uses free ip-api.com service. IP is sent for lookup but NEVER stored.

export async function geolocateIP(ip: string): Promise<string | null> {
  try {
    // Skip private/localhost IPs
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.")
    ) {
      return null;
    }

    const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.city && data.regionName) {
      return `${data.city}, ${data.regionName}`;
    }
    if (data.country) {
      return data.country;
    }
    return null;
  } catch {
    return null;
  }
}
