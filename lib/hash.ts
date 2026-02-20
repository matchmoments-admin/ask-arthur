// Shared SHA-256 hashing utility for privacy-preserving identifiers.
// Used by rate limiting, scam reporting, and other modules that need
// to generate consistent, non-reversible identifiers from user metadata.

/** Generate a privacy-preserving SHA-256 identifier from IP + User-Agent */
export async function hashIdentifier(ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${ua}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
