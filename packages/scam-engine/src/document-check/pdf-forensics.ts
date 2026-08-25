// PDF structural forensics — dependency-free byte walk over hostile input.
//
// The STRUCTURAL layer of the Document Check Module (sibling discipline to
// metadata-origin.ts / c2pa-detect.ts): a targeted scan for the editing
// traces a PDF accumulates when it is modified — incremental updates,
// changed trailer IDs, producer-tool tells, divergent timestamps, XMP edit
// history. A general PDF library (pdf-lib etc.) is deliberately NOT used:
// parsers normalise and REPAIR exactly the anomalies we are here to observe,
// and these bytes are attacker-controlled — a targeted scan is less parser
// surface than a full object-graph parser.
//
// Epistemics (ADR-0015/0024 applied to documents): output is a factual
// summary plus NAMED findings. Nothing here scores, weighs, or concludes
// "fake"; absence of every signal is NOT evidence of authenticity (a freshly
// generated fraudulent document has no revision history).
//
// Adversarial-input rules this file follows everywhere (2026-08-21 review of
// PR #1028 — each rule closed a CONFIRMED finding):
// - Structural tokens (startxref / %%EOF / /Encrypt / /ObjStm) only count
//   OUTSIDE stream…endstream ranges and only at a token boundary — content
//   streams and embedded PDFs (PDF/A-3 e-invoice attachments) must not
//   inflate the revision count or fire false findings on legitimate files.
// - /Info fields are resolved through the trailer's /Info N G R reference to
//   the actual Info object — never a byte-anywhere lastIndexOf, which was
//   both spoofable (appended "/Producer (Xero)" in a comment shadowed the
//   real Photoshop entry) and a false-positive source.
// - The linearization discount requires a real /Linearized dict in the FIRST
//   object whose /L equals the exact file length — a "/Linearized" comment
//   can't cancel a genuine incremental update, and any append changes the
//   length, voiding the discount.
// - /ID is read from the LAST trailer region only (literal and hex string
//   forms); an unparseable last trailer reports null (unknown), never an
//   earlier trailer's answer.
// - Every backward walk is capped (MAX_WALK) and every string scan is
//   window-bounded — a 10 MB upload of pathological bytes must cost O(N),
//   not O(N²), on this anonymous route.
// - A malformed single field degrades to null for THAT field only; the scan
//   never throws and never collapses to isPdf:false because one string was
//   bad (the swap16 odd-length crash class).

import type {
  DocumentFinding,
  PdfInfoFields,
  PdfStructuralSummary,
  PdfXmpSummary,
} from "@askarthur/types";

// Producer/Creator classification — data, not logic. Conservative on
// purpose: a false "made with a design tool" against a legitimate document
// is worse than a miss. Matched case-insensitively against BOTH fields.
const DESIGN_TOOL_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /photoshop/i, name: "Adobe Photoshop" },
  { re: /illustrator/i, name: "Adobe Illustrator" },
  { re: /indesign/i, name: "Adobe InDesign" },
  { re: /\bgimp\b/i, name: "GIMP" },
  { re: /\bcanva\b/i, name: "Canva" },
  { re: /photopea/i, name: "Photopea" },
  { re: /affinity (?:photo|designer|publisher)/i, name: "Affinity" },
  { re: /coreldraw/i, name: "CorelDRAW" },
  { re: /inkscape/i, name: "Inkscape" },
  { re: /\bfigma\b/i, name: "Figma" },
];

const OFFICE_SUITE_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /microsoft.{0,4}word|\bword\b.{0,10}for (?:microsoft|windows|mac)/i, name: "Microsoft Word" },
  { re: /libreoffice|openoffice/i, name: "LibreOffice / OpenOffice" },
  { re: /google docs/i, name: "Google Docs" },
  { re: /apple pages|\bpages\b.{0,6}\d/i, name: "Apple Pages" },
  { re: /wps office/i, name: "WPS Office" },
];

const MAX_SCAN_BYTES = 25_000_000; // hard stop — route caps uploads well below
const MAX_WALK = 64; // cap on every backward lastIndexOf loop
const MAX_STRING_LEN = 2048; // longest field string we'll decode
const MAX_STREAMS = 10_000; // cap on stream-range discovery

const tok = (s: string): Buffer => Buffer.from(s, "latin1");

// ---------- stream ranges ---------------------------------------------------

interface ByteRange {
  start: number;
  end: number;
}

const isAlnum = (b: number): boolean =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);

/** Locate stream…endstream payload ranges so structural tokens inside
 *  content/attachment streams (including whole embedded PDFs) are ignored.
 *  Best-effort: binary payloads containing the literal "endstream" end a
 *  range early — acceptable, the goal is excluding well-formed payloads. */
function findStreamRanges(buf: Buffer): ByteRange[] {
  const ranges: ByteRange[] = [];
  const streamTok = tok("stream");
  const endTok = tok("endstream");
  let pos = 0;
  while (ranges.length < MAX_STREAMS) {
    const s = buf.indexOf(streamTok, pos);
    if (s < 0) break;
    // token boundary: skip the "stream" inside "endstream"
    if (s > 0 && isAlnum(buf[s - 1]!)) {
      pos = s + 6;
      continue;
    }
    const dataStart = s + 6;
    const e = buf.indexOf(endTok, dataStart);
    if (e < 0) {
      ranges.push({ start: dataStart, end: buf.length });
      break;
    }
    ranges.push({ start: dataStart, end: e });
    pos = e + endTok.length;
  }
  return ranges;
}

/** Ranges are discovered in ascending order — binary search membership. */
function inStream(ranges: ByteRange[], idx: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (idx < r.start) hi = mid - 1;
    else if (idx >= r.end) lo = mid + 1;
    else return true;
  }
  return false;
}

// ---------- token counting --------------------------------------------------

const isDelim = (b: number | undefined): boolean =>
  b === undefined ||
  b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00 ||
  b === 0x2f || b === 0x3c || b === 0x3e || b === 0x5b || b === 0x5d || b === 0x28 || b === 0x25;

/** Count token occurrences outside stream payloads, requiring a PDF token
 *  boundary on both sides (so "/Encrypt" ≠ "/EncryptMetadata", and a token
 *  inside prose can't match without surrounding delimiters). */
function countToken(buf: Buffer, token: string, ranges: ByteRange[]): number {
  const needle = tok(token);
  let count = 0;
  let pos = 0;
  while (pos <= buf.length - needle.length) {
    const hit = buf.indexOf(needle, pos);
    if (hit < 0) break;
    pos = hit + needle.length;
    if (inStream(ranges, hit)) continue;
    const before = hit > 0 ? buf[hit - 1] : undefined;
    const after = buf[hit + needle.length];
    if ((isDelim(before) || before === undefined) && (isDelim(after) || after === undefined)) {
      count++;
    }
  }
  return count;
}

/** Last occurrence of a token outside stream payloads, capped walk. */
function lastTokenOutside(buf: Buffer, token: string, ranges: ByteRange[]): number {
  const needle = tok(token);
  let pos = buf.lastIndexOf(needle);
  for (let i = 0; i < MAX_WALK && pos >= 0; i++) {
    if (!inStream(ranges, pos)) return pos;
    pos = buf.lastIndexOf(needle, pos - 1);
  }
  return -1;
}

// ---------- PDF string reading ----------------------------------------------

/** Read a PDF string object's RAW bytes starting at `pos` (after optional
 *  whitespace): literal `(…)` with escapes, or hex `<…>`. Window-bounded:
 *  never scans more than a few KB past `pos`. Null when `pos` doesn't start
 *  a parseable string. `end` is the offset just past the closing delimiter,
 *  so a caller can read consecutive strings (the /ID pair). */
function readPdfStringAt(
  buf: Buffer,
  pos: number,
): { bytes: Buffer; end: number } | null {
  while (
    pos < buf.length &&
    (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09)
  ) {
    pos++;
  }
  if (pos >= buf.length) return null;

  if (buf[pos] === 0x28 /* ( */) {
    const out: number[] = [];
    let depth = 1;
    let i = pos + 1;
    const limit = Math.min(buf.length, pos + 1 + MAX_STRING_LEN * 4);
    while (i < limit && out.length < MAX_STRING_LEN) {
      const b = buf[i]!;
      if (b === 0x5c /* \ */ && i + 1 < buf.length) {
        const next = buf[i + 1]!;
        const escapes: Record<number, number> = {
          0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c,
          0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c,
        };
        if (next in escapes) {
          out.push(escapes[next]!);
          i += 2;
          continue;
        }
        if (next >= 0x30 && next <= 0x37) {
          let oct = 0;
          let j = i + 1;
          while (j < buf.length && j < i + 4 && buf[j]! >= 0x30 && buf[j]! <= 0x37) {
            oct = oct * 8 + (buf[j]! - 0x30);
            j++;
          }
          out.push(oct & 0xff);
          i = j;
          continue;
        }
        i += 2;
        continue;
      }
      if (b === 0x28) depth++;
      if (b === 0x29) {
        depth--;
        if (depth === 0) return { bytes: Buffer.from(out), end: i + 1 };
      }
      out.push(b);
      i++;
    }
    return null; // unterminated within window
  }

  if (buf[pos] === 0x3c /* < */ && buf[pos + 1] !== 0x3c) {
    // Window-bounded close scan — an unterminated '<' must cost O(window),
    // not O(distance-to-EOF) (the O(N²) DoS class).
    const window = Math.min(buf.length, pos + 1 + MAX_STRING_LEN * 2 + 64);
    let end = -1;
    for (let i = pos + 1; i < window; i++) {
      if (buf[i] === 0x3e /* > */) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    const hex = buf.subarray(pos + 1, end).toString("latin1").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
    return { bytes: Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex"), end: end + 1 };
  }

  return null;
}

/** PDFDocEncoding ≈ latin1 for the fields we read; UTF-16BE is signalled by
 *  a BOM. Never throws — an odd-length UTF-16 payload drops its dangling
 *  byte instead of crashing swap16 (which would have collapsed the whole
 *  scan through the caller's catch). */
function decodePdfText(bytes: Buffer): string | null {
  try {
    if (bytes.length === 0) return null;
    let text: string;
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let body = bytes.subarray(2);
      if (body.length % 2 === 1) body = body.subarray(0, body.length - 1);
      text = Buffer.from(body).swap16().toString("utf16le");
    } else {
      text = bytes.toString("latin1");
    }
    const cleaned = text.replace(/\0/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/** First occurrence of `key` within a SLICE (one dict), then its string. */
function readStringFieldIn(slice: Buffer, key: string): string | null {
  const needle = tok(key);
  let pos = slice.indexOf(needle);
  for (let i = 0; i < 8 && pos >= 0; i++) {
    const read = readPdfStringAt(slice, pos + needle.length);
    if (read) return decodePdfText(read.bytes);
    pos = slice.indexOf(needle, pos + needle.length);
  }
  return null;
}

// ---------- /Info dict resolution -------------------------------------------

/** Resolve the trailer's `/Info N G R` reference to the LAST `N G obj` in
 *  the file (appended revisions legitimately redefine Info — latest wins)
 *  and read the fields from that object only. Byte-anywhere scans are
 *  spoofable and false-positive-prone; "not found" reports null, which the
 *  scan_limited finding covers when object streams are present. */
function readInfoFields(buf: Buffer, ranges: ByteRange[]): PdfInfoFields {
  const empty: PdfInfoFields = { producer: null, creator: null, creationDate: null, modDate: null };

  const infoTok = tok("/Info");
  let pos = buf.lastIndexOf(infoTok);
  let ref: { num: number; gen: number } | null = null;
  for (let i = 0; i < MAX_WALK && pos >= 0; i++) {
    if (!inStream(ranges, pos)) {
      const window = buf.subarray(pos, Math.min(pos + 48, buf.length)).toString("latin1");
      const m = window.match(/^\/Info\s+(\d{1,10})\s+(\d{1,5})\s+R/);
      if (m) {
        ref = { num: Number(m[1]), gen: Number(m[2]) };
        break;
      }
    }
    pos = buf.lastIndexOf(infoTok, pos - 1);
  }
  if (!ref) return empty;

  const objNeedle = tok(`${ref.num} ${ref.gen} obj`);
  let objPos = buf.lastIndexOf(objNeedle);
  for (let i = 0; i < MAX_WALK && objPos >= 0; i++) {
    const before = objPos > 0 ? buf[objPos - 1] : undefined;
    const beforeIsDigit = before !== undefined && before >= 0x30 && before <= 0x39;
    if (!inStream(ranges, objPos) && !beforeIsDigit) break;
    objPos = buf.lastIndexOf(objNeedle, objPos - 1);
  }
  if (objPos < 0) return empty;

  const endObj = buf.indexOf(tok("endobj"), objPos);
  const sliceEnd = Math.min(endObj > objPos ? endObj : objPos + 8192, objPos + 8192, buf.length);
  const slice = buf.subarray(objPos, sliceEnd);

  return {
    producer: readStringFieldIn(slice, "/Producer"),
    creator: readStringFieldIn(slice, "/Creator"),
    creationDate: readStringFieldIn(slice, "/CreationDate"),
    modDate: readStringFieldIn(slice, "/ModDate"),
  };
}

// ---------- date handling ---------------------------------------------------

/** Parse a PDF date (D:YYYYMMDDHHmmSS±HH'mm') to epoch millis, or null. */
export function parsePdfDate(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(
    /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})?'?(\d{2})?)?/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tzSign, tzH, tzM] = m;
  const utc = Date.UTC(
    Number(y),
    Number(mo ?? "01") - 1,
    Number(d ?? "01"),
    Number(h ?? "00"),
    Number(mi ?? "00"),
    Number(s ?? "00"),
  );
  if (Number.isNaN(utc)) return null;
  if (tzSign === "+" || tzSign === "-") {
    const offsetMin = Number(tzH ?? "00") * 60 + Number(tzM ?? "00");
    return utc - (tzSign === "+" ? 1 : -1) * offsetMin * 60_000;
  }
  return utc;
}

// ---------- linearization ---------------------------------------------------

/** True only for a REAL linearized file: the first object is a /Linearized
 *  dict whose /L equals the exact file length. A "/Linearized" comment can't
 *  earn the extra-xref-pair discount, and appending anything changes the
 *  length, voiding it — so the discount can never hide a real update. */
function isLinearized(buf: Buffer, fileLength: number): boolean {
  const head = buf.subarray(0, 2048);
  const objIdx = head.indexOf(tok(" obj"));
  if (objIdx < 0) return false;
  const sliceEnd = Math.min(objIdx + 1024, buf.length);
  const slice = buf.subarray(objIdx, sliceEnd).toString("latin1");
  const endObj = slice.indexOf("endobj");
  const dict = endObj > 0 ? slice.slice(0, endObj) : slice;
  if (!dict.includes("/Linearized")) return false;
  const l = dict.match(/\/L\s+(\d{1,12})/);
  return l !== null && Number(l[1]) === fileLength;
}

// ---------- XMP -------------------------------------------------------------

function readXmpSummary(buf: Buffer): PdfXmpSummary {
  const empty: PdfXmpSummary = {
    present: false,
    creatorTool: null,
    createDate: null,
    modifyDate: null,
    historyEvents: null,
    derivedFrom: false,
  };
  const start = buf.lastIndexOf(tok("<?xpacket begin"));
  if (start < 0) return empty;
  const endTag = buf.indexOf(tok("<?xpacket end"), start);
  const xmp = buf
    .subarray(start, endTag > start ? endTag : Math.min(start + 65_536, buf.length))
    .toString("utf8");

  const attrOrEl = (name: string): string | null => {
    const m = xmp.match(
      new RegExp(`${name}\\s*(?:=\\s*"([^"]+)"|>\\s*([^<]+?)\\s*<)`, "i"),
    );
    return m?.[1] ?? m?.[2] ?? null;
  };

  const openIdx = xmp.search(/<xmpMM:History/i);
  const closeIdx = xmp.search(/<\/xmpMM:History>/i);
  const historyBlock =
    openIdx >= 0
      ? xmp.slice(openIdx, closeIdx > openIdx ? closeIdx : Math.min(openIdx + 20000, xmp.length))
      : null;
  const historyEvents = historyBlock
    ? (historyBlock.match(/stEvt:action/gi)?.length ?? (historyBlock.match(/<rdf:li\b/gi)?.length ?? 0))
    : null;

  return {
    present: true,
    creatorTool: attrOrEl("(?:xmp|xap):CreatorTool"),
    createDate: attrOrEl("(?:xmp|xap):CreateDate"),
    modifyDate: attrOrEl("(?:xmp|xap):ModifyDate"),
    historyEvents,
    derivedFrom: /xmpMM:DerivedFrom/i.test(xmp),
  };
}

// ---------- trailer /ID -----------------------------------------------------

/** Compare the LAST trailer's /ID pair — literal and hex string forms both
 *  parse (readPdfStringBytes handles either). An unparseable or absent pair
 *  in the LAST trailer reports null (unknown); we never fall back to an
 *  earlier trailer, whose matching pair would mask a modified file. */
function readTrailerIdMatches(buf: Buffer, ranges: ByteRange[]): boolean | null {
  let region: Buffer | null = null;

  const trailerPos = lastTokenOutside(buf, "trailer", ranges);
  if (trailerPos >= 0) {
    region = buf.subarray(trailerPos, Math.min(trailerPos + 2048, buf.length));
  } else {
    // Cross-reference-stream PDF: the /ID lives in the xref stream dict at
    // the offset the last startxref points to.
    const sx = buf.lastIndexOf(tok("startxref"));
    if (sx < 0) return null;
    const digits = buf.subarray(sx + 9, Math.min(sx + 32, buf.length)).toString("latin1");
    const off = digits.match(/(\d{1,12})/)?.[1];
    if (!off) return null;
    const at = Number(off);
    if (!Number.isFinite(at) || at < 0 || at >= buf.length) return null;
    region = buf.subarray(at, Math.min(at + 2048, buf.length));
  }

  const idPos = region.indexOf(tok("/ID"));
  if (idPos < 0) return null;
  let p = idPos + 3;
  while (p < region.length && region[p] !== 0x5b /* [ */) {
    if (p - idPos > 16) return null;
    p++;
  }
  if (p >= region.length) return null;
  const first = readPdfStringAt(region, p + 1); // skips leading whitespace
  if (!first || first.bytes.length === 0) return null;
  const second = readPdfStringAt(region, first.end);
  if (!second || second.bytes.length === 0) return null;
  return first.bytes.equals(second.bytes);
}

// ---------- main ------------------------------------------------------------

const NOT_PDF: PdfStructuralSummary = {
  isPdf: false,
  pdfVersion: null,
  byteLength: 0,
  eofCount: 0,
  startxrefCount: 0,
  linearized: false,
  incrementalUpdates: 0,
  encrypted: false,
  hasObjectStreams: false,
  info: { producer: null, creator: null, creationDate: null, modDate: null },
  xmp: {
    present: false,
    creatorTool: null,
    createDate: null,
    modifyDate: null,
    historyEvents: null,
    derivedFrom: false,
  },
  trailerIdMatches: null,
};

/** Run one field-reader, degrading to a fallback on ANY error — a malformed
 *  string must cost that field, never the scan ("never throws / best-effort
 *  partial fields" is this module's contract). */
function safe<T>(fallback: T, fn: () => T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Read the structural summary of a PDF. Never throws; non-PDF, truncated,
 * or pathological input reports {isPdf:false} or best-effort partial fields.
 * Callers must treat missing fields as "not found", never as "absent".
 */
export function inspectPdfStructure(input: Buffer): PdfStructuralSummary {
  try {
    const buf = input.subarray(0, MAX_SCAN_BYTES);
    if (buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return { ...NOT_PDF, byteLength: input.length };
    }

    const versionMatch = buf.subarray(0, 16).toString("latin1").match(/%PDF-(\d\.\d)/);
    const ranges = safe<ByteRange[]>([], () => findStreamRanges(buf));
    const startxrefCount = safe(0, () => countToken(buf, "startxref", ranges));
    const linearized = safe(false, () => isLinearized(buf, input.length));

    return {
      isPdf: true,
      pdfVersion: versionMatch?.[1] ?? null,
      byteLength: input.length,
      eofCount: safe(0, () => countToken(buf, "%%EOF", ranges)),
      startxrefCount,
      linearized,
      // A single-revision file has one startxref (two when genuinely
      // linearized); every incremental update appends one more.
      incrementalUpdates: Math.max(0, startxrefCount - (linearized ? 2 : 1)),
      encrypted: safe(0, () => countToken(buf, "/Encrypt", ranges)) > 0,
      hasObjectStreams: safe(0, () => countToken(buf, "/ObjStm", ranges)) > 0,
      info: safe(NOT_PDF.info, () => readInfoFields(buf, ranges)),
      xmp: safe(NOT_PDF.xmp, () => readXmpSummary(buf)),
      trailerIdMatches: safe(null, () => readTrailerIdMatches(buf, ranges)),
    };
  } catch {
    return { ...NOT_PDF, byteLength: input.length };
  }
}

function matchToolClass(
  patterns: Array<{ re: RegExp; name: string }>,
  ...fields: Array<string | null>
): string | null {
  for (const field of fields) {
    if (!field) continue;
    for (const { re, name } of patterns) {
      if (re.test(field)) return name;
    }
  }
  return null;
}

/**
 * Turn a structural summary into named findings. Pure data → data; the
 * display strings live in DOCUMENT_CHECK_COPY. An empty array means "no
 * editing traces found" — which the UI must present with the asymmetry
 * caveat (DOCUMENT_CHECK_CLEAN_COPY), never as "genuine".
 */
export function collectStructuralFindings(s: PdfStructuralSummary): DocumentFinding[] {
  if (!s.isPdf) return [];
  const findings: DocumentFinding[] = [];

  if (s.incrementalUpdates >= 1) {
    findings.push({
      signal: "multiple_revisions",
      evidence: { updates: s.incrementalUpdates, startxrefCount: s.startxrefCount },
    });
  }

  if (s.trailerIdMatches === false && s.incrementalUpdates === 0) {
    // With updates ≥ 1 the ID divergence is implied — one signal is enough.
    findings.push({ signal: "trailer_id_changed", evidence: {} });
  }

  const designTool = matchToolClass(
    DESIGN_TOOL_PATTERNS,
    s.info.producer,
    s.info.creator,
    s.xmp.creatorTool,
  );
  if (designTool) {
    findings.push({ signal: "producer_design_tool", evidence: { tool: designTool } });
  }

  const officeSuite = designTool
    ? null
    : matchToolClass(OFFICE_SUITE_PATTERNS, s.info.producer, s.info.creator, s.xmp.creatorTool);
  if (officeSuite) {
    findings.push({ signal: "producer_office_suite", evidence: { tool: officeSuite } });
  }

  const created = parsePdfDate(s.info.creationDate);
  const modified = parsePdfDate(s.info.modDate);
  if (created !== null && modified !== null && modified !== created) {
    findings.push({
      signal: "dates_differ",
      evidence: {
        creationDate: s.info.creationDate ?? "",
        modDate: s.info.modDate ?? "",
      },
    });
  }

  if ((s.xmp.historyEvents ?? 0) >= 1 || s.xmp.derivedFrom) {
    findings.push({
      signal: "xmp_edit_history",
      evidence: {
        events: s.xmp.historyEvents ?? 0,
        ...(s.xmp.derivedFrom ? { derivedFrom: "yes" } : {}),
      },
    });
  }

  if (s.encrypted) {
    findings.push({ signal: "encrypted_document", evidence: {} });
  }

  const nothingRead =
    !s.info.producer && !s.info.creator && !s.info.creationDate && !s.xmp.present;
  if (s.hasObjectStreams && nothingRead) {
    findings.push({ signal: "scan_limited", evidence: {} });
  }

  return findings;
}
