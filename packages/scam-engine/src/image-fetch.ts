// SSRF-safe image-byte fetch shared by the image-check surfaces (extension
// analyze-image route, public /api/image-check). Promoted out of the
// extension route when the public checker became the second caller.
//
// Callers MUST run assertSafeURL on the URL first — this fetch adds the
// DNS-rebinding defence (ssrfSafeDispatcher re-checks the resolved IP), a
// no-redirect policy, a 5 MB cap, and magic-byte validation. Returns null on
// any failure: byte-derived signals are best-effort, never a reason to fail
// a check. Bytes live only for the request; they are never stored
// (ADR-0022 / ADR-0010).

import { ssrfSafeDispatcher } from "./ssrf-dispatcher";
import { validateImageMagicBytes } from "./image-validate";
import { readBodyCapped } from "@askarthur/utils/read-body-capped";

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
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
      ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
    });
    if (!res.ok) return null;

    // Streamed with a hard cap: a missing or wrong Content-Length can't make
    // us buffer more than MAX_BYTES.
    const body = await readBodyCapped(res, MAX_BYTES);
    if (!body.ok) return null;
    const buffer = Buffer.from(body.bytes);
    if (buffer.length === 0) return null;

    const base64 = buffer.toString("base64");
    const { valid } = validateImageMagicBytes(base64);
    if (!valid) return null;

    return { buffer, base64, sha256: await sha256Hex(buffer) };
  } catch {
    return null;
  }
}
