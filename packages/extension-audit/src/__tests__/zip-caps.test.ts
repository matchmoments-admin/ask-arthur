import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readZipEntryTextCapped, zipInflateBound } from "@askarthur/utils/zip-entry-capped";

describe("readZipEntryTextCapped", () => {
  it("reads an entry under the cap", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "hello world");
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    expect(await readZipEntryTextCapped(loaded.file("a.txt")!, 100)).toBe("hello world");
  });

  it("stops at the uncompressed cap even when the compressed entry is tiny", async () => {
    const zip = new JSZip();
    zip.file("bomb.txt", "0".repeat(20 * 1024 * 1024)); // 20 MB of zeros → ~20 KB deflated
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect(bytes.byteLength).toBeLessThan(200_000);
    const loaded = await JSZip.loadAsync(bytes);
    expect(await readZipEntryTextCapped(loaded.file("bomb.txt")!, 1024 * 1024)).toBeNull();
  });
});

describe("readZipEntryTextCapped — decompression stops at the cap", () => {
  it("delivers no further data once the cap is crossed", async () => {
    const zip = new JSZip();
    zip.file("bomb.txt", "0".repeat(20 * 1024 * 1024));
    const loaded = await JSZip.loadAsync(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    );
    const entry = loaded.file("bomb.txt")!;
    // Observe every chunk the decompressor produces, including after we stop.
    let produced = 0;
    const realStream = (entry as unknown as { internalStream: (t: string) => { on: (e: string, cb: (c: Uint8Array) => void) => unknown } }).internalStream.bind(entry);
    const spy = {
      internalStream: (t: "uint8array") => {
        const h = realStream(t);
        h.on("data", (c: Uint8Array) => {
          produced += c.byteLength;
        });
        return h;
      },
    };
    const cap = 1024 * 1024;
    expect(await readZipEntryTextCapped(spy as never, cap)).toBeNull();
    const atStop = produced;
    await new Promise((r) => setTimeout(r, 300));
    expect(produced).toBe(atStop); // nothing inflated after the pause
    // Bounded by the cap plus one compressed chunk's expansion, independent of
    // the entry's total size (20 MB here; an unbounded inflate would reach it).
    expect(produced).toBeLessThanOrEqual(zipInflateBound(cap));
  });

  it("stops well short of the full entry when the entry is far larger than one chunk can expand", async () => {
    const zip = new JSZip();
    zip.file("huge.txt", "0".repeat(120 * 1024 * 1024)); // 120 MB
    const loaded = await JSZip.loadAsync(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    );
    let produced = 0;
    const e = loaded.file("huge.txt")! as unknown as { internalStream: (t: string) => { on: (ev: string, cb: (c: Uint8Array) => void) => unknown } };
    const spy = {
      internalStream: (t: string) => {
        const h = e.internalStream(t);
        h.on("data", (c) => {
          produced += c.byteLength;
        });
        return h;
      },
    };
    expect(await readZipEntryTextCapped(spy, 1024 * 1024)).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(produced).toBeLessThanOrEqual(zipInflateBound(1024 * 1024));
    expect(produced).toBeLessThan(120 * 1024 * 1024 / 2);
  });
});

describe("extractSourceFiles — total source budget", () => {
  it("never holds more than MAX_TOTAL_SOURCE_BYTES across files", async () => {
    const { extractSourceFiles, MAX_TOTAL_SOURCE_BYTES } = await import("../scanner");
    const zip = new JSZip();
    // 40 files × 400 KB = 16 MB, each under the per-file cap.
    for (let i = 0; i < 40; i++) zip.file(`f${i}.js`, "a".repeat(400_000));
    const buf = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const sources = await extractSourceFiles(buf);
    const total = [...sources.values()].reduce((n, s) => n + Buffer.byteLength(s), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
    expect(sources.size).toBeGreaterThan(0);
    expect(sources.size).toBeLessThan(40);
  });

  it("counts bytes, not characters (multi-byte source)", async () => {
    const { extractSourceFiles, MAX_TOTAL_SOURCE_BYTES } = await import("../scanner");
    const zip = new JSZip();
    // "é" is 2 bytes in UTF-8: 30 files × 200k chars = 12 MB of bytes, 6M chars.
    for (let i = 0; i < 30; i++) zip.file(`m${i}.js`, "é".repeat(200_000));
    const buf = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const sources = await extractSourceFiles(buf);
    const total = [...sources.values()].reduce((n, s) => n + Buffer.byteLength(s), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
  });
});
