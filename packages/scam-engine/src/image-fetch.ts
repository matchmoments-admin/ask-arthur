// SSRF-safe image-byte fetch shared by the image-check surfaces (extension
// analyze-image route, public /api/image-check). Promoted out of the
// extension route when the public checker became the second caller.
//
// Transport is `safeFetch` (guard + SSRF-safe dispatcher + no redirects +
// 5 MB streamed cap); this file adds magic-byte validation. Returns null on
// any failure: byte-derived signals are best-effort, never a reason to fail
// a check. Bytes live only for the request; they are never stored
// (ADR-0022 / ADR-0010).

import { safeFetch } from "./safe-fetch";
import { validateImageMagicBytes } from "./image-validate";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 5_000_000;

export interface FetchedImage {
  buffer: Buffer;
  base64: string;
  sha256: string;
}

export async function sha256Hex(buffer: Buffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchImageBytes(imageUrl: string): Promise<FetchedImage | null> {
  try {
    const r = await safeFetch(imageUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      // An image URL must not bounce anywhere else.
      redirect: "error",
      as: "bytes",
    });
    if (!r.ok) return null;
    const buffer = Buffer.from(r.body);
    if (buffer.length === 0) return null;

    const base64 = buffer.toString("base64");
    const { valid } = validateImageMagicBytes(base64);
    if (!valid) return null;

    return { buffer, base64, sha256: await sha256Hex(buffer) };
  } catch {
    return null;
  }
}
