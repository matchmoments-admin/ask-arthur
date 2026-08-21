// PDF text extraction — the content layer's input seam.
//
// This is the Document Check Module's ONE deliberate exception to the
// no-parser-deps rule (metadata-origin.ts doctrine): extracting text needs
// Flate inflation and CID font maps, which is a multi-month project to
// hand-roll. pdfjs-dist is the most-fuzzed PDF parser in existence (it
// ships in Firefox), and it runs here under strict containment:
// - only AFTER the dependency-free structural walk admitted the file;
// - `isEvalSupported: false` (no PostScript-function eval);
// - a hard timeout that destroys the parse;
// - page and character caps;
// - any failure returns null — the content layer reports "not assessed"
//   (the ADR-0009 unverified discipline), never a finding.

import { logger } from "@askarthur/utils/logger";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PAGES = 20;
const MAX_CHARS = 200_000;

interface ExtractOptions {
  timeoutMs?: number;
  maxPages?: number;
}

/** Extract plain text from a PDF, or null when extraction can't run or
 *  yields nothing. Null means "not assessed" — a scanned/image-only PDF is
 *  the common benign cause. Never throws. */
export async function extractPdfText(
  buffer: Buffer,
  opts: ExtractOptions = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  let task: { destroy: () => Promise<void> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // pdfjs-dist 6.x removed PostScript-function eval entirely, so there is
    // no isEvalSupported switch to turn off any more.
    const loadingTask = pdfjs.getDocument({
      // Copy: pdfjs transfers/detaches the buffer it is given.
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    });
    task = loadingTask;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("pdf_text_timeout")), timeoutMs);
    });

    const extracted = await Promise.race([
      (async () => {
        const loaded = await loadingTask.promise;
        const pages = Math.min(loaded.numPages, maxPages);
        const parts: string[] = [];
        let chars = 0;
        for (let i = 1; i <= pages && chars < MAX_CHARS; i++) {
          const page = await loaded.getPage(i);
          const content = await page.getTextContent();
          const text = content.items
            .map((it) => ("str" in it ? it.str : ""))
            .join(" ");
          chars += text.length;
          parts.push(text);
        }
        return parts.join("\n");
      })(),
      timeout,
    ]);

    const text = extracted.slice(0, MAX_CHARS).trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    // Timeout, encrypted, malformed, image-only — all "not assessed".
    logger.warn("extractPdfText: extraction unavailable", { error: String(err) });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      // Destroying the loading task tears down the document and worker too —
      // the teardown path pdfjs 6.x supports.
      await task?.destroy();
    } catch {
      // already torn down
    }
  }
}
