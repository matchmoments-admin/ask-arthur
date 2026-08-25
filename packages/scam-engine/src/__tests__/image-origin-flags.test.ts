import { describe, it, expect, vi, beforeEach } from "vitest";

// collectImageOriginRedFlags — network fetch and native C2PA validation are
// mocked; the detectors (c2pa-detect, metadata-origin) run REAL over
// synthetic byte fixtures.
vi.mock("../image-fetch", () => ({
  fetchImageBytes: vi.fn(),
}));
vi.mock("../c2pa-verify", () => ({
  verifyC2PA: vi.fn(),
}));

import { collectImageOriginRedFlags } from "../image-origin-flags";
import { fetchImageBytes } from "../image-fetch";
import { verifyC2PA } from "../c2pa-verify";

const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

function jpegWithSegments(segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (const seg of segments) {
    const length = seg.payload.length + 2;
    parts.push(
      Buffer.from([0xff, seg.marker, (length >> 8) & 0xff, length & 0xff]),
      seg.payload,
    );
  }
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00]));
  return Buffer.concat(parts);
}

const CLAIMED_JPEG = jpegWithSegments([
  {
    marker: 0xe1,
    payload: Buffer.concat([
      Buffer.from(XMP_HEADER, "ascii"),
      Buffer.from(
        '<rdf:Description xmp:CreatorTool="Midjourney v7" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>',
        "utf8",
      ),
    ]),
  },
]);

const CLEAN_JPEG = jpegWithSegments([
  { marker: 0xe0, payload: Buffer.from("JFIF\0", "ascii") },
]);

// Manifest-bearing JPEG: APP11 JUMBF with the c2pa label (as in c2pa-detect tests).
const C2PA_JPEG = jpegWithSegments([
  {
    marker: 0xeb,
    payload: Buffer.concat([
      Buffer.from("JP", "ascii"),
      Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x20]),
      Buffer.from("jumb", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("jumd", "ascii"),
      Buffer.alloc(4, 0),
      Buffer.from("c2pa\0", "ascii"),
    ]),
  },
]);

function mockBytes(buffer: Buffer | null) {
  vi.mocked(fetchImageBytes).mockResolvedValue(
    buffer ? { buffer, base64: buffer.toString("base64"), sha256: "00" } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectImageOriginRedFlags", () => {
  it("returns [] when bytes are unreachable — could-not-check is not a flag", async () => {
    mockBytes(null);
    expect(
      await collectImageOriginRedFlags("https://x.test/a.jpg", { validateC2pa: false }),
    ).toEqual([]);
  });

  it("flags a claimed AI origin with no Content Credentials, naming the generator", async () => {
    mockBytes(CLAIMED_JPEG);
    const flags = await collectImageOriginRedFlags("https://x.test/a.jpg", {
      validateC2pa: false,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("claiming AI origin");
    expect(flags[0]).toContain("Midjourney");
    expect(flags[0]).toContain("hint");
  });

  it("clean image → no flags (absence is never evidence)", async () => {
    mockBytes(CLEAN_JPEG);
    expect(
      await collectImageOriginRedFlags("https://x.test/a.jpg", { validateC2pa: false }),
    ).toEqual([]);
  });

  it("a manifest-bearing image without validation → no flags (presence alone is fine)", async () => {
    mockBytes(C2PA_JPEG);
    const flags = await collectImageOriginRedFlags("https://x.test/a.jpg", {
      validateC2pa: false,
    });
    expect(flags).toEqual([]);
    expect(vi.mocked(verifyC2PA)).not.toHaveBeenCalled();
  });

  it("invalid C2PA signature → tamper flag (never the word 'fake')", async () => {
    mockBytes(C2PA_JPEG);
    vi.mocked(verifyC2PA).mockResolvedValue({
      validationState: "invalid",
      signatureValid: false,
      issuer: null,
      generator: null,
    });
    const flags = await collectImageOriginRedFlags("https://x.test/a.jpg", {
      validateC2pa: true,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/altered/i);
    expect(flags[0]).not.toMatch(/fake/i);
  });

  it("valid signature → no flags (properly-credentialed AI content is not a red flag)", async () => {
    mockBytes(C2PA_JPEG);
    vi.mocked(verifyC2PA).mockResolvedValue({
      validationState: "valid",
      signatureValid: true,
      issuer: "Adobe Inc.",
      generator: "Adobe Firefly",
    });
    expect(
      await collectImageOriginRedFlags("https://x.test/a.jpg", { validateC2pa: true }),
    ).toEqual([]);
  });
});
