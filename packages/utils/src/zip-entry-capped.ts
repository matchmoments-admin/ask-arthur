// Read one zip entry with a cap on its UNCOMPRESSED size. A small archive can
// inflate to gigabytes; `file.async("text")` inflates the whole entry before
// any length check can run. Streaming the entry and stopping at the cap bounds
// the memory and CPU spent regardless of the compression ratio.
//
// Typed structurally against JSZip's `internalStream` so this package needs no
// jszip dependency; pass a JSZip `ZipObject`.

/** JSZip's internal StreamHelper: `pause()` pauses the whole worker chain back
 *  to the compressed-data source, so inflation itself stops (a destroyed Node
 *  stream wrapper would keep the workers running). */
interface StreamHelperLike {
  on(event: "data", cb: (chunk: Uint8Array) => void): StreamHelperLike;
  on(event: "error", cb: (err: unknown) => void): StreamHelperLike;
  on(event: "end", cb: () => void): StreamHelperLike;
  pause(): StreamHelperLike;
  resume(): StreamHelperLike;
}

interface ZipEntryLike {
  internalStream(type: "uint8array"): StreamHelperLike;
}

/** Deflate's maximum expansion ratio: a compressed chunk can inflate ~1032×. */
const DEFLATE_MAX_RATIO = 1032;
/** JSZip reads compressed data in 16 KiB chunks and hands each to pako whole. */
const JSZIP_INPUT_CHUNK_BYTES = 16 * 1024;

/**
 * Worst-case bytes inflated before decompression stops: the cap plus one
 * compressed input chunk's expansion. pako inflates a chunk synchronously, so
 * a pause lands between chunks, never inside one. Exported for tests.
 */
export function zipInflateBound(maxBytes: number): number {
  return maxBytes + JSZIP_INPUT_CHUNK_BYTES * DEFLATE_MAX_RATIO;
}

/**
 * The entry's text, or null when its uncompressed size exceeds `maxBytes`.
 * Decompression is paused (never resumed) as soon as the cap is crossed, so
 * total inflation work is bounded by {@link zipInflateBound} regardless of the
 * archive's compression ratio. `entry` is a JSZip `ZipObject` (its public
 * typings omit `internalStream`, hence `object`).
 */
export function readZipEntryTextCapped(
  entry: object,
  maxBytes: number,
): Promise<string | null> {
  const zipEntry = entry as Partial<ZipEntryLike>;
  if (typeof zipEntry.internalStream !== "function") {
    return Promise.reject(new Error("readZipEntryTextCapped: not a JSZip entry"));
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = zipEntry.internalStream!("uint8array");
    stream
      .on("data", (chunk) => {
        if (settled) return;
        total += chunk.byteLength;
        if (total > maxBytes) {
          settled = true;
          stream.pause();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.byteLength;
        }
        resolve(new TextDecoder().decode(bytes));
      })
      .resume();
  });
}
