// Read one zip entry with a cap on its UNCOMPRESSED size. A small archive can
// inflate to gigabytes; `file.async("text")` inflates the whole entry before
// any length check can run. Streaming the entry and stopping at the cap bounds
// the memory and CPU spent regardless of the compression ratio.
//
// Typed structurally against JSZip's `nodeStream` (Node runtime) so this
// package needs no jszip dependency; pass a JSZip `ZipObject`.

interface ReadableLike {
  on(event: "data", cb: (chunk: Uint8Array) => void): this;
  on(event: "error", cb: (err: unknown) => void): this;
  on(event: "end", cb: () => void): this;
  pause(): this;
}

export interface ZipEntryLike {
  nodeStream(type: "nodebuffer"): ReadableLike;
}

/** The entry's text, or null when its uncompressed size exceeds `maxBytes`. */
export function readZipEntryTextCapped(
  entry: ZipEntryLike,
  maxBytes: number,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = entry.nodeStream("nodebuffer");
    stream.on("data", (chunk) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        settled = true;
        stream.pause();
        (stream as { destroy?: () => void }).destroy?.();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      resolve(new TextDecoder().decode(bytes));
    });
  });
}
