import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { readZipEntryTextCapped, zipInflateBound } from "@askarthur/utils/zip-entry-capped";
import { extractSourceFiles, MAX_TOTAL_SOURCE_BYTES } from "../scanner";

const MB = 1024 * 1024;
const CAP = MB;
/** The most one compressed chunk can add past the cap (zipInflateBound's slack). */
const ONE_CHUNK_EXPANSION = zipInflateBound(CAP) - CAP;

type Streamable = { internalStream: (t: string) => { on: (e: string, cb: (c: Uint8Array) => void) => unknown } };

/** Wrap an entry so every chunk the decompressor produces is counted —
 *  including any produced after readZipEntryTextCapped stops listening. */
function counting(entry: object) {
  const e = entry as Streamable;
  const state = { produced: 0 };
  const spy = {
    internalStream: (t: string) => {
      const h = e.internalStream(t);
      h.on("data", (c) => {
        state.produced += c.byteLength;
      });
      return h;
    },
  };
  return { spy, state };
}

const zipOf = (files: Record<string, string>) => {
  const z = new JSZip();
  for (const [name, body] of Object.entries(files)) z.file(name, body);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
};

// Fixtures are built ONCE: generating and deflating tens of MB per test is
// what exceeded the default 5 s test timeout on CI runners. Each test then
// only performs the capped read, which is fast by construction.
let bomb: Uint8Array; // 20 MB entry
let huge: Uint8Array; // 4× one chunk's maximum expansion
let manySources: ArrayBuffer; // 25 × 480 KB ASCII files = 12 MB (> 10 MB budget)
let multiByteSources: ArrayBuffer; // 25 × 240k "é" = 12 MB of UTF-8 (6M chars)

beforeAll(async () => {
  bomb = await zipOf({ "bomb.txt": "0".repeat(20 * MB) });
  huge = await zipOf({ "huge.txt": "0".repeat(4 * ONE_CHUNK_EXPANSION) });
  const ascii: Record<string, string> = {};
  const wide: Record<string, string> = {};
  for (let i = 0; i < 25; i++) {
    ascii[`f${i}.js`] = "a".repeat(480_000);
    wide[`m${i}.js`] = "é".repeat(240_000);
  }
  manySources = ((await zipOf(ascii)) as Uint8Array).slice().buffer;
  multiByteSources = ((await zipOf(wide)) as Uint8Array).slice().buffer;
}, 60_000); // one-off fixture build; the tests themselves run under the default

describe("readZipEntryTextCapped", () => {
  it("reads an entry under the cap", async () => {
    const loaded = await JSZip.loadAsync(await zipOf({ "a.txt": "hello world" }));
    expect(await readZipEntryTextCapped(loaded.file("a.txt")!, 100)).toBe("hello world");
  });

  it("stops at the uncompressed cap even when the compressed entry is tiny", async () => {
    expect(bomb.byteLength).toBeLessThan(200_000);
    const loaded = await JSZip.loadAsync(bomb);
    expect(await readZipEntryTextCapped(loaded.file("bomb.txt")!, CAP)).toBeNull();
  });
});

describe("readZipEntryTextCapped — decompression stops at the cap", () => {
  it("delivers no further data once the cap is crossed", async () => {
    const loaded = await JSZip.loadAsync(bomb);
    const { spy, state } = counting(loaded.file("bomb.txt")!);
    expect(await readZipEntryTextCapped(spy, CAP)).toBeNull();
    const atStop = state.produced;
    await new Promise((r) => setTimeout(r, 200));
    expect(state.produced).toBe(atStop); // nothing inflated after the pause
    expect(state.produced).toBeLessThanOrEqual(zipInflateBound(CAP));
  });

  it("stops well short of the full entry when it is 4× larger than one chunk can expand", async () => {
    const loaded = await JSZip.loadAsync(huge);
    const { spy, state } = counting(loaded.file("huge.txt")!);
    expect(await readZipEntryTextCapped(spy, CAP)).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(state.produced).toBeLessThanOrEqual(zipInflateBound(CAP));
    // An unbounded inflate would reach 4 × ONE_CHUNK_EXPANSION.
    expect(state.produced).toBeLessThan(2 * ONE_CHUNK_EXPANSION);
  });
});

describe("extractSourceFiles — total source budget", () => {
  const bytesOf = (sources: Map<string, string>) =>
    [...sources.values()].reduce((n, s) => n + Buffer.byteLength(s), 0);

  it("never holds more than MAX_TOTAL_SOURCE_BYTES across files", async () => {
    const sources = await extractSourceFiles(manySources);
    expect(bytesOf(sources)).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
    expect(sources.size).toBeGreaterThan(0);
    expect(sources.size).toBeLessThan(25);
  });

  it("counts bytes, not characters (multi-byte source)", async () => {
    const sources = await extractSourceFiles(multiByteSources);
    expect(bytesOf(sources)).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
  });
});
