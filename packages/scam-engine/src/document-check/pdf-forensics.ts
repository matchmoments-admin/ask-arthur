// PDF structural forensics — dependency-free byte walk over hostile input.
//
// The STRUCTURAL layer of the Document Check Module (sibling discipline to
// metadata-origin.ts / c2pa-detect.ts): a targeted scan for the editing
// traces a PDF accumulates when it is modified — incremental updates,
// changed trailer IDs, producer-tool tells, divergent timestamps, XMP edit
// history. A general PDF library (pdf-lib etc.) is deliberately NOT used:
// parsers normalise and REPAIR exactly the anomalies we are here to observe,
// and these bytes are attacker-controlled — a ~300-line scan is less parser
// surface than a full object-graph parser.
//
// Epistemics (ADR-0015/0024 applied to documents): output is a factual
// summary plus NAMED findings. Nothing here scores, weighs, or concludes
// "fake"; absence of every signal is NOT evidence of authenticity (a
// freshly generated fraudulent document has no revision history). Copy for
// these signals lives in @askarthur/types/document-check-copy.
//
// Reading notes:
// - Incremental updates: each re-save appends objects + a new xref section +
//   trailer + %%EOF, so `startxref` count exceeds one. Linearized ("fast web
//   view") files legitimately carry one extra xref pair — detected via the
//   /Linearized hint dict near the header and discounted.
// - /Info fields and the XMP packet are read via LAST occurrence — appended
//   revisions win, matching how a conforming reader resolves them.
// - On modern PDFs metadata often lives inside compressed object streams
//   (/ObjStm) this scan doesn't inflate. That reports as a `scan_limited`
//   finding, never as a clean result — "didn't find" ≠ "absent".

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

// ---------- byte-scan primitives -------------------------------------------

/** Count non-overlapping occurrences of an ASCII token. */
function countToken(buf: Buffer, token: string): number {
  const needle = Buffer.from(token, "latin1");
  let count = 0;
  let pos = 0;
  while (pos <= buf.length - needle.length) {
    const hit = buf.indexOf(needle, pos);
    if (hit < 0) break;
    count++;
    pos = hit + needle.length;
  }
  return count;
}

function lastIndexOfToken(buf: Buffer, token: string): number {
  return buf.lastIndexOf(Buffer.from(token, "latin1"));
}

/** Read a PDF string object starting at `pos` (after whitespace): either a
 *  literal `(…)` with escape handling or a hex string `<…>`. Returns the
 *  decoded text (UTF-16BE with BOM handled) or null when `pos` doesn't start
 *  a string. Truncates pathological lengths — this is a forensic read, not a
 *  renderer. */
function readPdfString(buf: Buffer, pos: number): string | null {
  while (pos < buf.length && (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09)) {
    pos++;
  }
  if (pos >= buf.length) return null;

  const MAX_LEN = 2048;

  if (buf[pos] === 0x28 /* ( */) {
    const out: number[] = [];
    let depth = 1;
    let i = pos + 1;
    while (i < buf.length && out.length < MAX_LEN) {
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
          // octal escape, 1–3 digits
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
        i += 2; // line continuation or unknown escape — drop
        continue;
      }
      if (b === 0x28) depth++;
      if (b === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(b);
      i++;
    }
    return decodePdfText(Buffer.from(out));
  }

  if (buf[pos] === 0x3c /* < */ && buf[pos + 1] !== 0x3c) {
    const end = buf.indexOf(0x3e /* > */, pos + 1);
    if (end < 0 || end - pos > MAX_LEN * 2) return null;
    const hex = buf.subarray(pos + 1, end).toString("latin1").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
    const bytes = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
    return decodePdfText(bytes);
  }

  return null;
}

/** PDFDocEncoding is close enough to latin1 for the fields we read; UTF-16BE
 *  is signalled by a BOM per spec. */
function decodePdfText(bytes: Buffer): string | null {
  if (bytes.length === 0) return null;
  const text =
    bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
      ? Buffer.from(bytes.subarray(2)).swap16().toString("utf16le")
      : bytes.toString("latin1");
  const cleaned = text.replace(/\0/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Latest-revision-wins read of a name-keyed string field (/Producer etc.). */
function readLastStringField(buf: Buffer, key: string): string | null {
  const needle = Buffer.from(key, "latin1");
  let pos = buf.lastIndexOf(needle);
  while (pos >= 0) {
    const value = readPdfString(buf, pos + needle.length);
    if (value !== null) return value;
    pos = buf.lastIndexOf(needle, pos - 1);
  }
  return null;
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
  const start = lastIndexOfToken(buf, "<?xpacket begin");
  if (start < 0) return empty;
  const endTag = buf.indexOf(Buffer.from("<?xpacket end", "latin1"), start);
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

/** Compare the LAST trailer /ID pair. false = pair differs (file changed
 *  since creation); null = no pair found. */
function readTrailerIdMatches(buf: Buffer): boolean | null {
  let pos = lastIndexOfToken(buf, "/ID");
  while (pos >= 0) {
    const window = buf.subarray(pos, Math.min(pos + 200, buf.length)).toString("latin1");
    const m = window.match(/\/ID\s*\[\s*<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*\]/);
    if (m) {
      const a = m[1]!.replace(/\s+/g, "").toLowerCase();
      const b = m[2]!.replace(/\s+/g, "").toLowerCase();
      if (a.length > 0 && b.length > 0) return a === b;
    }
    pos = buf.lastIndexOf(Buffer.from("/ID", "latin1"), pos - 1);
  }
  return null;
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
    const startxrefCount = countToken(buf, "startxref");
    const linearized = buf.subarray(0, 2048).includes("/Linearized");
    const info: PdfInfoFields = {
      producer: readLastStringField(buf, "/Producer"),
      creator: readLastStringField(buf, "/Creator"),
      creationDate: readLastStringField(buf, "/CreationDate"),
      modDate: readLastStringField(buf, "/ModDate"),
    };

    return {
      isPdf: true,
      pdfVersion: versionMatch?.[1] ?? null,
      byteLength: input.length,
      eofCount: countToken(buf, "%%EOF"),
      startxrefCount,
      linearized,
      // A single-revision file has one startxref (two when linearized);
      // every incremental update appends one more.
      incrementalUpdates: Math.max(0, startxrefCount - (linearized ? 2 : 1)),
      encrypted: countToken(buf, "/Encrypt") > 0,
      hasObjectStreams: countToken(buf, "/ObjStm") > 0,
      info,
      xmp: readXmpSummary(buf),
      trailerIdMatches: readTrailerIdMatches(buf),
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
