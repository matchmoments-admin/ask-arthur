// Shared SHA-256 hashing utility for privacy-preserving identifiers.
// Used by rate limiting, scam reporting, and other modules that need
// to generate consistent, non-reversible identifiers from user metadata.

/** SHA-256 hex digest of an arbitrary string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a privacy-preserving SHA-256 identifier from IP + User-Agent */
export async function hashIdentifier(ip: string, ua: string): Promise<string> {
  return sha256Hex(`${ip}:${ua}`);
}
