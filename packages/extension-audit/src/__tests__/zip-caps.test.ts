import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readZipEntryTextCapped } from "@askarthur/utils/zip-entry-capped";

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
