import { describe, it, expect } from "vitest";
import { detectC2PA } from "../c2pa-detect";

// Synthetic minimal containers — hand-built byte fixtures, no real images.

function jpegWithSegments(
  segments: Array<{ marker: number; payload: Buffer }>,
  opts: { truncateLast?: boolean } = {},
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  for (const seg of segments) {
    const length = seg.payload.length + 2;
    const header = Buffer.from([0xff, seg.marker, (length >> 8) & 0xff, length & 0xff]);
    parts.push(header, seg.payload);
  }
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00])); // SOS then "data"
  let buf = Buffer.concat(parts);
  if (opts.truncateLast) buf = buf.subarray(0, buf.length - 5);
  return buf;
}

// A JUMBF-ish APP11 payload: CI header + superbox with "jumb" type and a
// description box carrying the "c2pa" label.
const JUMBF_C2PA_PAYLOAD = Buffer.concat([
  Buffer.from("JP", "ascii"),
  Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from("jumb", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("jumd", "ascii"),
  Buffer.alloc(4, 0),
  Buffer.from("c2pa\0", "ascii"),
]);

function pngWithChunks(types: string[]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = types.map((t) => {
    const data = Buffer.alloc(4, 0xab);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(t, "ascii"), data, Buffer.alloc(4, 0)]);
  });
  return Buffer.concat([sig, ...chunks]);
}

function webpWithChunks(fourCCs: string[]): Buffer {
  const chunks = fourCCs.map((c) => {
    const data = Buffer.alloc(4, 0xcd);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(data.length);
    return Buffer.concat([Buffer.from(c, "ascii"), size, data]);
  });
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), riffSize, body]);
}

describe("detectC2PA", () => {
  it("detects a JUMBF c2pa manifest in a JPEG APP11 segment", () => {
    const buf = jpegWithSegments([
      { marker: 0xe0, payload: Buffer.from("JFIF\0", "ascii") },
      { marker: 0xeb, payload: JUMBF_C2PA_PAYLOAD },
    ]);
    expect(detectC2PA(buf)).toEqual({ present: true, format: "jpeg" });
  });

  it("ignores APP11 segments without the c2pa label", () => {
    const buf = jpegWithSegments([
      { marker: 0xeb, payload: Buffer.from("JPsomething-else-jumb", "ascii") },
    ]);
    expect(detectC2PA(buf).present).toBe(false);
  });

  it("does NOT false-positive on c2pa/jumb bytes in non-APP11 segments", () => {
    // A provenance signal must not be fabricatable via arbitrary payloads.
    const buf = jpegWithSegments([
      { marker: 0xe1, payload: Buffer.concat([JUMBF_C2PA_PAYLOAD]) }, // APP1, not APP11
    ]);
    expect(detectC2PA(buf).present).toBe(false);
  });

  it("survives a truncated JPEG without throwing", () => {
    const buf = jpegWithSegments([{ marker: 0xeb, payload: JUMBF_C2PA_PAYLOAD }], {
      truncateLast: true,
    });
    expect(() => detectC2PA(buf)).not.toThrow();
  });

  it("detects a PNG caBX chunk", () => {
    expect(detectC2PA(pngWithChunks(["IHDR", "caBX", "IEND"]))).toEqual({
      present: true,
      format: "png",
    });
  });

  it("clean PNG → not present", () => {
    expect(detectC2PA(pngWithChunks(["IHDR", "IDAT", "IEND"])).present).toBe(false);
  });

  it("detects a WebP C2PA chunk", () => {
    expect(detectC2PA(webpWithChunks(["VP8 ", "C2PA"]))).toEqual({
      present: true,
      format: "webp",
    });
  });

  it("clean WebP → not present", () => {
    expect(detectC2PA(webpWithChunks(["VP8 ", "EXIF"])).present).toBe(false);
  });

  it("unknown container (GIF) → not present, no throw", () => {
    expect(detectC2PA(Buffer.from("GIF89a....", "ascii")).present).toBe(false);
  });

  it("empty buffer → not present", () => {
    expect(detectC2PA(Buffer.alloc(0)).present).toBe(false);
  });
});
