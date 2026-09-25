// Read a fetch Response body with a hard byte cap, streaming — the one shared
// shape for "download, but never more than N bytes". `arrayBuffer()` / `text()`
// buffer the whole body before any size check can run, and a declared
// Content-Length is advisory (absent on chunked responses, or simply wrong),
// so a cap applied afterwards bounds nothing. Dependency-free: safe to import
// from apps/web, site-audit and the bots.

export type CappedBody =
  | { ok: true; bytes: Uint8Array; truncated: boolean }
  | { ok: false; reason: "too_large" | "no_body" };

export interface CapOptions {
  /** Keep the first `maxBytes` and stop, instead of rejecting — for callers
   *  that only need the head of a document (HTML audits). */
  truncate?: boolean;
}

/**
 * Stream `res.body` into memory, stopping (and cancelling the stream) as soon
 * as more than `maxBytes` would be held. Rejects early on a declared
 * Content-Length above the cap. Never throws for size — errors from the
 * underlying stream propagate.
 */
export async function readBodyCapped(
  res: Response,
  maxBytes: number,
  opts: CapOptions = {},
): Promise<CappedBody> {
  const declared = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  if (!opts.truncate && Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too_large" };
  }
  const body = res.body;
  if (!body) return { ok: false, reason: "no_body" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        if (!opts.truncate) return { ok: false, reason: "too_large" };
        const room = maxBytes - total;
        if (room > 0) chunks.push(value.subarray(0, room));
        total = maxBytes;
        truncated = true;
        break;
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes, truncated };
}

/** `readBodyCapped` decoded as UTF-8 text, or null when over the cap/empty. */
export async function readTextCapped(
  res: Response,
  maxBytes: number,
  opts: CapOptions = {},
): Promise<string | null> {
  const r = await readBodyCapped(res, maxBytes, opts);
  return r.ok ? new TextDecoder().decode(r.bytes) : null;
}
