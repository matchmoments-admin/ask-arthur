import { describe, expect, it } from "vitest";
import { extractPdfText } from "../document-check/pdf-text";

// Text extraction had NO test until 2026-08-23 — every document-check test
// asserted structural bytes, so a totally inert extractor passed the suite.
// It duly went inert in the deployed bundle (pdfjs 6.x throws
// `ReferenceError: DOMMatrix is not defined` at module scope on the Vercel
// runtime; see ensureCanvasGlobals in pdf-text.ts). This file builds a REAL
// PDF with a real text stream and asserts we get the words back.
//
// NOTE the limit of this guard: it runs in Node, where the missing globals
// are partly masked. It cannot reproduce the deployed failure — only a
// preview/production smoke can (documented in
// docs/ops/document-check-config.md). Its job is to catch an extractor that
// stops extracting for any other reason.

/** Minimal valid single-page PDF with an uncompressed text stream. */
function buildTextPdf(lines: string[]): Buffer {
  const body =
    "BT /F1 12 Tf 72 780 Td 14 TL\n" +
    lines.map((l) => `(${l}) Tj T*\n`).join("") +
    "ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Producer (Xero Payroll) /CreationDate (D:20260812093000Z) >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractPdfText", () => {
  it("returns the document's actual words, not null", async () => {
    const pdf = buildTextPdf([
      "TAX INVOICE",
      "Sunrise Property Services Pty Ltd",
      "ABN 51 824 753 556",
      "Total due ...................... $1,364.00",
    ]);
    const text = await extractPdfText(pdf);
    expect(text).toBeTruthy();
    expect(text).toContain("TAX INVOICE");
    // The ABN digits must survive extraction — the AU pack reads them from
    // exactly this string.
    expect(text!.replace(/\s/g, "")).toContain("51824753556");
  });

  it("returns null (never throws) for bytes that aren't a readable PDF", async () => {
    expect(await extractPdfText(Buffer.from("GIF89a not a pdf"))).toBeNull();
  });

  it("returns null for a structurally-valid PDF with no text", async () => {
    expect(await extractPdfText(buildTextPdf([]))).toBeNull();
  });
});
