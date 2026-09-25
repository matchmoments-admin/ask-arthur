import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Count every entry the scanner asks to inflate.
const reads = vi.hoisted(() => ({ n: 0 }));
vi.mock("@askarthur/utils/zip-entry-capped", async (orig) => {
  const actual = await orig<typeof import("@askarthur/utils/zip-entry-capped")>();
  return {
    ...actual,
    readZipEntryTextCapped: (entry: object, max: number) => {
      reads.n++;
      return actual.readZipEntryTextCapped(entry, max);
    },
  };
});

import { extractSourceFiles, MAX_TOTAL_SOURCE_BYTES } from "../scanner";

const bytesOf = (s: Map<string, string>) =>
  [...s.values()].reduce((n, v) => n + Buffer.byteLength(v), 0);

let overBudget: ArrayBuffer; // 25 × 480 KB = 12 MB of ASCII
let invalidUtf8: ArrayBuffer; // 20 × 250 KB of 0xFF: decodes to 3× (U+FFFD)

beforeAll(async () => {
  const a = new JSZip();
  const b = new JSZip();
  for (let i = 0; i < 25; i++) a.file(`f${String(i).padStart(2, "0")}.js`, "a".repeat(480_000));
  for (let i = 0; i < 20; i++) b.file(`x${String(i).padStart(2, "0")}.js`, new Uint8Array(250_000).fill(0xff));
  overBudget = (await a.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })) as ArrayBuffer;
  invalidUtf8 = (await b.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })) as ArrayBuffer;
}, 60_000);

describe("extractSourceFiles — budget exhaustion", () => {
  it("stops inflating entries once the total budget is used up", async () => {
    reads.n = 0;
    const sources = await extractSourceFiles(overBudget);
    expect(bytesOf(sources)).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
    // Every kept file was read once; at most ONE more read found the budget spent.
    expect(reads.n).toBeLessThanOrEqual(sources.size + 1);
    expect(reads.n).toBeLessThan(25);
  });

  it("accounts the DECODED bytes, so invalid UTF-8 cannot overshoot the budget", async () => {
    const sources = await extractSourceFiles(invalidUtf8);
    expect(bytesOf(sources)).toBeLessThanOrEqual(MAX_TOTAL_SOURCE_BYTES);
  });
});
