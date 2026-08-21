// Structural forensics tests over synthesized PDFs — no committed binaries.
// The builder writes real (minimal) PDF syntax: header, one page object
// tree, an /Info dict, xref table, trailer, %%EOF — then `appendUpdate`
// performs an actual incremental update (new object + xref section + trailer
// with /Prev + second %%EOF), which is exactly what an editor's "save"
// appends to a genuine file.

import { describe, expect, it } from "vitest";
import {
  collectStructuralFindings,
  inspectPdfStructure,
  parsePdfDate,
} from "../document-check/pdf-forensics";

interface BuildOptions {
  producer?: string;
  creator?: string;
  creationDate?: string;
  modDate?: string;
  linearized?: boolean;
  id?: [string, string];
  xmp?: string;
}

function buildPdf(opts: BuildOptions = {}): Buffer {
  const parts: string[] = [];
  const offsets: number[] = [];
  let body = "%PDF-1.7\n%âãÏÓ\n";

  const push = (obj: string): void => {
    offsets.push(body.length);
    body += obj;
  };

  if (opts.linearized) {
    // /L must equal the final byte length — patched by patchLinearizedLength.
    push("1 0 obj\n<< /Linearized 1 /L 000000 /O 3 /E 999 /N 1 /T 999 >>\nendobj\n");
  } else {
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  }
  push(
    opts.linearized
      ? "2 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n"
      : "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
  );
  push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n");

  const infoFields: string[] = [];
  if (opts.producer) infoFields.push(`/Producer (${opts.producer})`);
  if (opts.creator) infoFields.push(`/Creator (${opts.creator})`);
  if (opts.creationDate) infoFields.push(`/CreationDate (${opts.creationDate})`);
  if (opts.modDate) infoFields.push(`/ModDate (${opts.modDate})`);
  push(`4 0 obj\n<< ${infoFields.join(" ")} >>\nendobj\n`);

  if (opts.xmp) {
    const packet = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${opts.xmp}<?xpacket end="w"?>`;
    push(
      `5 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${packet.length} >>\nstream\n${packet}\nendstream\nendobj\n`,
    );
  }

  const xrefStart = body.length;
  const entries = offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  const id = opts.id ?? ["aabbccdd", "aabbccdd"];
  body +=
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info 4 0 R /ID [<${id[0]}> <${id[1]}>] >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  parts.push(body);
  return Buffer.from(parts.join(""), "latin1");
}

/** Fix up a linearized fixture so /L equals the true byte length (the
 *  structural check the discount now requires). Same-width replacement so
 *  offsets stay valid. */
function patchLinearizedLength(pdf: Buffer): Buffer {
  const padded = String(pdf.length).padStart(6, "0");
  return Buffer.from(pdf.toString("latin1").replace("/L 000000", `/L ${padded}`), "latin1");
}

/** A real incremental update: appended object, xref section, trailer with
 *  /Prev, new %%EOF — and a changed second /ID half. */
function appendUpdate(
  pdf: Buffer,
  opts: { modDate?: string; producer?: string; creationDate?: string } = {},
): Buffer {
  const base = pdf.toString("latin1");
  const prevStart = Number(base.match(/startxref\n(\d+)/g)?.pop()?.match(/(\d+)/)?.[1] ?? 0);
  let update = "";
  const objOffset = pdf.length;
  const fields: string[] = [];
  if (opts.producer) fields.push(`/Producer (${opts.producer})`);
  if (opts.creationDate) fields.push(`/CreationDate (${opts.creationDate})`);
  if (opts.modDate) fields.push(`/ModDate (${opts.modDate})`);
  update += `4 0 obj\n<< ${fields.join(" ")} >>\nendobj\n`;
  const xrefStart = pdf.length + update.length;
  update +=
    `xref\n4 1\n${String(objOffset).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size 6 /Root 1 0 R /Info 4 0 R /Prev ${prevStart} /ID [<aabbccdd> <99887766>] >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(update, "latin1")]);
}

describe("inspectPdfStructure", () => {
  it("reports a clean single-revision file with no findings", () => {
    const pdf = buildPdf({
      producer: "Xero Payroll",
      creationDate: "D:20260801120000+10'00'",
      modDate: "D:20260801120000+10'00'",
    });
    const s = inspectPdfStructure(pdf);
    expect(s.isPdf).toBe(true);
    expect(s.pdfVersion).toBe("1.7");
    expect(s.incrementalUpdates).toBe(0);
    expect(s.info.producer).toBe("Xero Payroll");
    expect(s.trailerIdMatches).toBe(true);
    expect(collectStructuralFindings(s)).toEqual([]);
  });

  it("rejects non-PDF bytes without throwing", () => {
    const s = inspectPdfStructure(Buffer.from("GIF89a not a pdf"));
    expect(s.isPdf).toBe(false);
    expect(collectStructuralFindings(s)).toEqual([]);
  });

  it("counts an incremental update and reads the LATEST revision's fields", () => {
    const original = buildPdf({
      producer: "Xero Payroll",
      creationDate: "D:20260801120000Z",
      modDate: "D:20260801120000Z",
    });
    // Editors carry CreationDate forward on re-save; only ModDate moves.
    const doctored = appendUpdate(original, {
      producer: "Adobe Photoshop 26.0",
      creationDate: "D:20260801120000Z",
      modDate: "D:20260815093000Z",
    });
    const s = inspectPdfStructure(doctored);
    expect(s.incrementalUpdates).toBe(1);
    expect(s.info.producer).toBe("Adobe Photoshop 26.0");
    expect(s.trailerIdMatches).toBe(false);

    const signals = collectStructuralFindings(s).map((f) => f.signal);
    expect(signals).toContain("multiple_revisions");
    expect(signals).toContain("producer_design_tool");
    expect(signals).toContain("dates_differ");
    // ID divergence is implied by multiple_revisions — not double-reported.
    expect(signals).not.toContain("trailer_id_changed");
  });

  it("does NOT count linearization's extra xref pair as an update", () => {
    const pdf = buildPdf({ linearized: true, producer: "Acrobat Distiller" });
    // Simulate the linearized layout's second startxref/%%EOF pair, then
    // patch /L to the true final length (the structural requirement).
    const withHint = patchLinearizedLength(
      Buffer.concat([pdf, Buffer.from("startxref\n0\n%%EOF\n", "latin1")]),
    );
    const s = inspectPdfStructure(withHint);
    expect(s.linearized).toBe(true);
    expect(s.incrementalUpdates).toBe(0);
  });

  it("a '/Linearized' header COMMENT cannot cancel a real incremental update", () => {
    // Forger writes the token as a comment in a non-linearized file, then
    // appends one genuine update — the discount must NOT apply.
    const base = buildPdf({ producer: "Xero Payroll" }).toString("latin1")
      .replace("%PDF-1.7\n", "%PDF-1.7\n%/Linearized 1 /L 999\n");
    const doctored = appendUpdate(Buffer.from(base, "latin1"), {
      modDate: "D:20260815093000Z",
    });
    const s = inspectPdfStructure(doctored);
    expect(s.linearized).toBe(false);
    expect(s.incrementalUpdates).toBe(1);
    expect(collectStructuralFindings(s).map((f) => f.signal)).toContain(
      "multiple_revisions",
    );
  });

  it("flags a changed trailer ID even without a countable update", () => {
    const pdf = buildPdf({ id: ["aabbccdd", "11223344"] });
    const s = inspectPdfStructure(pdf);
    expect(s.trailerIdMatches).toBe(false);
    expect(collectStructuralFindings(s).map((f) => f.signal)).toContain(
      "trailer_id_changed",
    );
  });

  it("classifies office suites separately from design tools", () => {
    const s = inspectPdfStructure(buildPdf({ creator: "Microsoft Word for Microsoft 365" }));
    const signals = collectStructuralFindings(s).map((f) => f.signal);
    expect(signals).toContain("producer_office_suite");
    expect(signals).not.toContain("producer_design_tool");
  });

  it("reads XMP creator tool and edit history", () => {
    const xmp =
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
      `<rdf:Description xmp:CreatorTool="Canva" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#">` +
      `<xmpMM:History><rdf:Seq><rdf:li stEvt:action="saved"/><rdf:li stEvt:action="saved"/></rdf:Seq></xmpMM:History>` +
      `</rdf:Description></rdf:RDF></x:xmpmeta>`;
    const s = inspectPdfStructure(buildPdf({ xmp }));
    expect(s.xmp.present).toBe(true);
    expect(s.xmp.creatorTool).toBe("Canva");
    expect(s.xmp.historyEvents).toBe(2);
    const signals = collectStructuralFindings(s).map((f) => f.signal);
    expect(signals).toContain("xmp_edit_history");
    expect(signals).toContain("producer_design_tool");
  });

  it("decodes UTF-16BE and escaped literal strings", () => {
    const utf16 = Buffer.from("Adobe Photoshop", "utf16le").swap16().toString("hex");
    const pdf = buildPdf({ creator: "paren \\(escaped\\)" }).toString("latin1")
      .replace("/Creator (paren \\(escaped\\))", `/Creator (paren \\(escaped\\)) /Producer <FEFF${utf16}>`);
    const s = inspectPdfStructure(Buffer.from(pdf, "latin1"));
    expect(s.info.creator).toBe("paren (escaped)");
    expect(s.info.producer).toBe("Adobe Photoshop");
  });
});

describe("edge signals", () => {
  it("notes encryption without treating it as suspicious on its own", () => {
    const raw = buildPdf({}).toString("latin1").replace(
      "/Root 1 0 R",
      "/Root 1 0 R /Encrypt 9 0 R",
    );
    const s = inspectPdfStructure(Buffer.from(raw, "latin1"));
    expect(s.encrypted).toBe(true);
    expect(collectStructuralFindings(s).map((f) => f.signal)).toContain(
      "encrypted_document",
    );
  });

  it("reports scan_limited when metadata is locked in object streams", () => {
    const raw =
      `%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 3 /First 20 >>\nstream\nxx\nendstream\nendobj\n` +
      `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n`;
    const s = inspectPdfStructure(Buffer.from(raw, "latin1"));
    expect(s.hasObjectStreams).toBe(true);
    expect(s.info.producer).toBeNull();
    expect(collectStructuralFindings(s).map((f) => f.signal)).toContain("scan_limited");
  });

  it("inspectDocument seam: hash + pairing in one call; content null when no pack requested", async () => {
    const { inspectDocument } = await import("../document-check");
    const doctored = appendUpdate(buildPdf({ producer: "Xero" }), {
      producer: "Canva",
    });
    const r = await inspectDocument(doctored);
    expect(r.docSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.structural.incrementalUpdates).toBe(1);
    expect(r.findings.map((f) => f.signal)).toContain("multiple_revisions");
    expect(r.content).toBeNull();
  });
});

describe("adversarial input (2026-08-21 review findings)", () => {
  it("an odd-length UTF-16BE string degrades ONE field, never the scan", () => {
    // <FEFF41> = BOM + 1 dangling byte — swap16 on it used to throw and
    // collapse the whole scan to isPdf:false via the outer catch.
    const raw = buildPdf({
      producer: "placeholder",
      creationDate: "D:20260801120000Z",
    }).toString("latin1").replace("/Producer (placeholder)", "/Producer <FEFF41>");
    const s = inspectPdfStructure(Buffer.from(raw, "latin1"));
    expect(s.isPdf).toBe(true);
    expect(s.info.creationDate).toBe("D:20260801120000Z");
  });

  it("a flood of unterminated '/Producer<' and '/ID' tokens completes in linear time", () => {
    const flood = Buffer.from(
      "%PDF-1.7\n" +
        "/Producer</ID".repeat(150_000) + // ~2 MB of pathological tokens
        "\ntrailer\n<< /Size 2 /Root 1 0 R /Info 4 0 R >>\nstartxref\n9\n%%EOF\n",
      "latin1",
    );
    const started = performance.now();
    const s = inspectPdfStructure(flood);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(s.isPdf).toBe(true);
  });

  it("structural tokens inside stream payloads (embedded PDFs) count nothing", () => {
    // A PDF/A-3-style attachment: a whole inner PDF inside a stream. Its
    // startxref/%%EOF//Encrypt//ObjStm bytes must not fire findings on the
    // pristine outer file.
    const inner = "%PDF-1.4\n/Encrypt /ObjStm\nstartxref\n0\n%%EOF\nstartxref\n0\n%%EOF\n";
    const raw = buildPdf({ producer: "Xero Payroll" }).toString("latin1").replace(
      "3 0 obj\n",
      `9 0 obj\n<< /Type /EmbeddedFile /Length ${inner.length} >>\nstream\n${inner}\nendstream\nendobj\n3 0 obj\n`,
    );
    const s = inspectPdfStructure(Buffer.from(raw, "latin1"));
    expect(s.incrementalUpdates).toBe(0);
    expect(s.encrypted).toBe(false);
    expect(s.hasObjectStreams).toBe(false);
    expect(collectStructuralFindings(s)).toEqual([]);
  });

  it("a spoofed /Producer inside a stream cannot shadow the real Info dict", () => {
    const raw = buildPdf({ producer: "Adobe Photoshop 26.0" }).toString("latin1").replace(
      "3 0 obj\n",
      `9 0 obj\n<< /Length 26 >>\nstream\n/Producer (Xero Payroll)\nendstream\nendobj\n3 0 obj\n`,
    );
    const s = inspectPdfStructure(Buffer.from(raw, "latin1"));
    expect(s.info.producer).toBe("Adobe Photoshop 26.0");
    expect(collectStructuralFindings(s).map((f) => f.signal)).toContain(
      "producer_design_tool",
    );
  });

  it("reads a literal-string /ID pair in the LAST trailer (mismatch detected)", () => {
    const base = buildPdf({ producer: "Xero Payroll" });
    const update = Buffer.from(
      `9 0 obj\n<< >>\nendobj\n` +
        `xref\n9 1\n0000000000 00000 n \n` +
        `trailer\n<< /Size 10 /Root 1 0 R /Prev 9 /ID [(aaaa) (bbbb)] >>\n` +
        `startxref\n${base.length}\n%%EOF\n`,
      "latin1",
    );
    const s = inspectPdfStructure(Buffer.concat([base, update]));
    expect(s.trailerIdMatches).toBe(false);
    expect(s.incrementalUpdates).toBe(1);
  });

  it("an unparseable LAST trailer /ID reports null — never an earlier trailer's answer", () => {
    const base = buildPdf({}); // original trailer: matching hex pair
    const update = Buffer.from(
      `trailer\n<< /Size 10 /Prev 9 /ID [garbage] >>\nstartxref\n${base.length}\n%%EOF\n`,
      "latin1",
    );
    const s = inspectPdfStructure(Buffer.concat([base, update]));
    expect(s.trailerIdMatches).toBeNull();
  });
});

describe("parsePdfDate", () => {
  it("parses timezone offsets", () => {
    expect(parsePdfDate("D:20260801120000+10'00'")).toBe(Date.UTC(2026, 7, 1, 2, 0, 0));
    expect(parsePdfDate("D:20260801120000Z")).toBe(Date.UTC(2026, 7, 1, 12, 0, 0));
    expect(parsePdfDate("D:2026")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(parsePdfDate("garbage")).toBeNull();
    expect(parsePdfDate(null)).toBeNull();
  });
});
