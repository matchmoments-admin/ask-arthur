import { describe, it, expect } from "vitest";
import { detectMetadataOrigin } from "../metadata-origin";

// Synthetic minimal containers — hand-built byte fixtures, no real images
// (same discipline as c2pa-detect.test.ts).

const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
const EXIF_HEADER = "Exif\0\0";

function jpegWithSegments(
  segments: Array<{ marker: number; payload: Buffer }>,
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  for (const seg of segments) {
    const length = seg.payload.length + 2;
    const header = Buffer.from([
      0xff,
      seg.marker,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
    parts.push(header, seg.payload);
  }
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00])); // SOS
  return Buffer.concat(parts);
}

function jpegWithXmp(xmp: string): Buffer {
  return jpegWithSegments([
    { marker: 0xe0, payload: Buffer.from("JFIF\0", "ascii") },
    {
      marker: 0xe1,
      payload: Buffer.concat([
        Buffer.from(XMP_HEADER, "ascii"),
        Buffer.from(xmp, "utf8"),
      ]),
    },
  ]);
}

/** Minimal little-endian TIFF whose IFD0 carries only Software (0x0131). */
function tiffWithSoftware(software: string): Buffer {
  const value = Buffer.from(`${software}\0`, "ascii");
  const header = Buffer.alloc(8);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4); // IFD0 at byte 8
  const ifd = Buffer.alloc(2 + 12 + 4);
  ifd.writeUInt16LE(1, 0); // one entry
  ifd.writeUInt16LE(0x0131, 2); // Software
  ifd.writeUInt16LE(2, 4); // ASCII
  ifd.writeUInt32LE(value.length, 6);
  // value lives right after the IFD (offset 8 + 18 = 26) unless it fits inline
  if (value.length <= 4) {
    value.copy(ifd, 10);
    return Buffer.concat([header, ifd]);
  }
  ifd.writeUInt32LE(26, 10);
  return Buffer.concat([header, ifd, value]);
}

function jpegWithExifSoftware(software: string): Buffer {
  return jpegWithSegments([
    {
      marker: 0xe1,
      payload: Buffer.concat([
        Buffer.from(EXIF_HEADER, "ascii"),
        tiffWithSoftware(software),
      ]),
    },
  ]);
}

function pngWithItxtXmp(xmp: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // keyword\0 compFlag(0) compMethod(0) lang\0 translated\0 text
  const data = Buffer.concat([
    Buffer.from("XML:com.adobe.xmp\0", "ascii"),
    Buffer.from([0, 0]),
    Buffer.from("\0\0", "ascii"),
    Buffer.from(xmp, "utf8"),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const chunk = Buffer.concat([
    len,
    Buffer.from("iTXt", "ascii"),
    data,
    Buffer.alloc(4, 0), // crc (unchecked)
  ]);
  const iend = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("IEND", "ascii"),
    Buffer.alloc(4, 0),
  ]);
  return Buffer.concat([sig, chunk, iend]);
}

function webpWithChunk(fourCC: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  const padded =
    data.length % 2 === 1 ? Buffer.concat([data, Buffer.alloc(1)]) : data;
  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    Buffer.from(fourCC, "ascii"),
    size,
    padded,
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), riffSize, body]);
}

const DST_TRAINED =
  '<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>';
const DST_COMPOSITE =
  '<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>';
const DST_CAPTURE =
  '<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"/>';

describe("detectMetadataOrigin", () => {
  it("claims on IPTC DigitalSourceType trainedAlgorithmicMedia (attribute form)", () => {
    const r = detectMetadataOrigin(jpegWithXmp(DST_TRAINED));
    expect(r.claimed).toBe(true);
    expect(r.source).toBe("xmp");
    expect(r.digitalSourceType).toBe("trainedAlgorithmicMedia");
  });

  it("claims on compositeWithTrainedAlgorithmicMedia (element form)", () => {
    const r = detectMetadataOrigin(jpegWithXmp(DST_COMPOSITE));
    expect(r.claimed).toBe(true);
    expect(r.digitalSourceType).toBe("compositeWithTrainedAlgorithmicMedia");
  });

  it("does NOT claim on digitalCapture — but still reports the term", () => {
    const r = detectMetadataOrigin(jpegWithXmp(DST_CAPTURE));
    expect(r.claimed).toBe(false);
    expect(r.digitalSourceType).toBe("digitalCapture");
  });

  it("claims on a known AI generator in xmp:CreatorTool, with display name", () => {
    const r = detectMetadataOrigin(
      jpegWithXmp('<rdf:Description xmp:CreatorTool="Adobe Firefly 3.0"/>'),
    );
    expect(r).toMatchObject({
      claimed: true,
      source: "xmp",
      generator: "Adobe Firefly",
    });
  });

  it("does NOT claim on an editor CreatorTool (Photoshop is not a generator)", () => {
    const r = detectMetadataOrigin(
      jpegWithXmp('<rdf:Description xmp:CreatorTool="Adobe Photoshop 25.0 (Macintosh)"/>'),
    );
    expect(r.claimed).toBe(false);
  });

  it("claims on EXIF Software naming a known generator", () => {
    const r = detectMetadataOrigin(jpegWithExifSoftware("Midjourney v7"));
    expect(r).toMatchObject({
      claimed: true,
      source: "exif",
      generator: "Midjourney",
    });
  });

  it("does NOT claim on camera EXIF Software", () => {
    const r = detectMetadataOrigin(jpegWithExifSoftware("NIKON Z 6_2 V1.10"));
    expect(r.claimed).toBe(false);
  });

  it("reads XMP from a PNG iTXt chunk", () => {
    const r = detectMetadataOrigin(pngWithItxtXmp(DST_TRAINED));
    expect(r.claimed).toBe(true);
    expect(r.source).toBe("xmp");
  });

  it("reads XMP from a WebP 'XMP ' chunk", () => {
    const r = detectMetadataOrigin(
      webpWithChunk("XMP ", Buffer.from(DST_TRAINED, "utf8")),
    );
    expect(r.claimed).toBe(true);
  });

  it("reads EXIF Software from a WebP EXIF chunk (Exif\\0\\0-prefixed)", () => {
    const r = detectMetadataOrigin(
      webpWithChunk(
        "EXIF",
        Buffer.concat([
          Buffer.from(EXIF_HEADER, "ascii"),
          tiffWithSoftware("Stable Diffusion XL"),
        ]),
      ),
    );
    expect(r).toMatchObject({ claimed: true, generator: "Stable Diffusion" });
  });

  it("does NOT false-positive on generator names in pixel-like data", () => {
    // The vocabulary URI inside a non-XMP segment must not fire — a claim
    // must not be fabricatable by arbitrary payload bytes.
    const buf = jpegWithSegments([
      { marker: 0xe7, payload: Buffer.from(DST_TRAINED, "utf8") }, // APP7, not XMP
    ]);
    expect(detectMetadataOrigin(buf).claimed).toBe(false);
  });

  it("stripped-clean JPEG → no claim, no throw", () => {
    const buf = jpegWithSegments([
      { marker: 0xe0, payload: Buffer.from("JFIF\0", "ascii") },
    ]);
    expect(detectMetadataOrigin(buf)).toMatchObject({ claimed: false });
  });

  it("unknown container / garbage / empty → no claim, no throw", () => {
    expect(detectMetadataOrigin(Buffer.from("GIF89a....", "ascii")).claimed).toBe(false);
    expect(detectMetadataOrigin(Buffer.alloc(0)).claimed).toBe(false);
    expect(() =>
      detectMetadataOrigin(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff])),
    ).not.toThrow();
  });

  it("truncated TIFF inside EXIF → no claim, no throw", () => {
    const truncated = jpegWithSegments([
      {
        marker: 0xe1,
        payload: Buffer.concat([
          Buffer.from(EXIF_HEADER, "ascii"),
          tiffWithSoftware("Midjourney").subarray(0, 12),
        ]),
      },
    ]);
    expect(() => detectMetadataOrigin(truncated)).not.toThrow();
    expect(detectMetadataOrigin(truncated).claimed).toBe(false);
  });
});
