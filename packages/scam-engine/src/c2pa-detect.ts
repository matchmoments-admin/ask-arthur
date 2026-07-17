// C2PA / Content Credentials PRESENCE detection — dependency-free.
//
// Scope (deliberate): detects whether an image container carries a C2PA
// manifest; it does NOT parse or cryptographically validate the manifest.
// Copy derived from this signal must say "present (issuer unverified)".
// Full validation (c2pa-node, issuer chain) is a tracked BACKLOG follow-up.
//
// Detection is a structural container walk, not a whole-file byte scan —
// substring scanning over compressed pixel data could false-positive, and a
// provenance signal must not be fabricatable by pixel content:
// - JPEG: APP11 (0xFFEB) marker segments carrying a JUMBF box whose payload
//   references the "c2pa" label (C2PA spec §embedding in JPEG).
// - PNG: a "caBX" chunk (C2PA spec §embedding in PNG).
// - WebP: a RIFF chunk with FourCC "C2PA".
// Truncated/malformed containers return {present:false} rather than throwing.

export interface C2PADetection {
  present: boolean;
  /** Container the manifest was found in — only set when present. */
  format?: "jpeg" | "png" | "webp";
}

const ASCII = (s: string): Buffer => Buffer.from(s, "ascii");
const JUMB = ASCII("jumb");
const C2PA = ASCII("c2pa");
const CABX = ASCII("caBX");
const C2PA_FOURCC = ASCII("C2PA");

function detectJpeg(buf: Buffer): boolean {
  // Walk marker segments after SOI (FF D8). Stop at SOS (FF DA) — after it
  // comes entropy-coded data where marker parsing no longer applies.
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return false; // desynced / not a marker — bail
    // Skip fill bytes (spec allows repeated 0xFF before a marker).
    let markerPos = pos + 1;
    while (markerPos < buf.length && buf[markerPos] === 0xff) markerPos++;
    if (markerPos >= buf.length) return false;
    const marker = buf[markerPos];

    // Standalone markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = markerPos + 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return false; // SOS / EOI

    if (markerPos + 3 > buf.length) return false;
    const length = buf.readUInt16BE(markerPos + 1);
    if (length < 2) return false;
    const segStart = markerPos + 3;
    const segEnd = markerPos + 1 + length;
    if (segEnd > buf.length) return false; // truncated

    if (marker === 0xeb) {
      // APP11 — JUMBF carrier. Presence = the segment payload references
      // both the JUMBF box type and the c2pa label.
      const seg = buf.subarray(segStart, segEnd);
      if (seg.includes(JUMB) && seg.includes(C2PA)) return true;
    }
    pos = segEnd;
  }
  return false;
}

function detectPng(buf: Buffer): boolean {
  // Chunks start after the 8-byte signature: len(4BE) type(4) data crc(4).
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8);
    if (type.equals(CABX)) return true;
    if (type.toString("ascii") === "IEND") return false;
    const next = pos + 8 + length + 4;
    if (next <= pos || next > buf.length) return false; // overflow/truncated
    pos = next;
  }
  return false;
}

function detectWebp(buf: Buffer): boolean {
  // RIFF: "RIFF" size(4LE) "WEBP", then chunks: fourCC(4) size(4LE) data
  // (padded to even length).
  if (buf.length < 12 || buf.subarray(8, 12).toString("ascii") !== "WEBP") {
    return false;
  }
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const fourCC = buf.subarray(pos, pos + 4);
    if (fourCC.equals(C2PA_FOURCC)) return true;
    const size = buf.readUInt32LE(pos + 4);
    const next = pos + 8 + size + (size % 2);
    if (next <= pos || next > buf.length) return false;
    pos = next;
  }
  return false;
}

/**
 * Detect the PRESENCE of a C2PA (Content Credentials) manifest in image
 * bytes. Never throws; unknown containers and malformed/truncated files
 * report {present: false}.
 */
export function detectC2PA(buf: Buffer): C2PADetection {
  try {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return detectJpeg(buf) ? { present: true, format: "jpeg" } : { present: false };
    }
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf.subarray(1, 4).toString("ascii") === "PNG"
    ) {
      return detectPng(buf) ? { present: true, format: "png" } : { present: false };
    }
    if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "RIFF") {
      return detectWebp(buf) ? { present: true, format: "webp" } : { present: false };
    }
    return { present: false };
  } catch {
    return { present: false };
  }
}
