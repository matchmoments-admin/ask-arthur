// PDF text extraction — the content layer's input seam.
//
// This is the Document Check Module's ONE deliberate exception to the
// no-parser-deps rule (metadata-origin.ts doctrine): extracting text needs
// Flate inflation and CID font maps, which is a multi-month project to
// hand-roll. It runs under strict containment:
// - only AFTER the dependency-free structural walk admitted the file;
// - a hard timeout;
// - page and character caps;
// - any failure returns null — the content layer reports "not assessed"
//   (the ADR-0009 unverified discipline), never a finding.
//
// WHY unpdf AND NOT pdfjs-dist DIRECTLY (measured, 2026-08-23 — three
// preview deployments):
// Raw pdfjs-dist cannot load on the Vercel runtime, in either bundling
// mode, and both failures are SILENT here because we degrade to null:
//   * `serverExternalPackages: ["pdfjs-dist"]` → Next's external-module
//     loader evaluates pdf.mjs where its canvas-global polyfills don't
//     apply → `ReferenceError: DOMMatrix is not defined`.
//   * bundled (the default) → gets past that, then dies in pdfjs's
//     fake-worker setup: `Cannot find module '.../pdf.worker.mjs'`, because
//     Vercel's file tracing follows the static import of pdf.mjs but not
//     the DYNAMIC import of its worker.
// Both reproduce ONLY in a deployed build — locally pdfjs prints the same
// canvas warnings and works fine, which is why 45 tests, CI and five review
// rounds all missed it. unpdf (unjs) exists precisely for this: it ships a
// serverless build of pdfjs with no worker and no canvas dependency, so
// there is no dynamic worker import for tracing to miss. Keeping raw pdfjs
// would mean pinning bundler-tracing globs across a pnpm workspace — a
// standing trap for the next dependency bump.

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

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("pdf_text_timeout")), timeoutMs);
    });

    const extracted = await Promise.race([
      (async () => {
        // Copy: the parser may transfer/detach the buffer it is given.
        const doc = await getDocumentProxy(new Uint8Array(buffer));
        const pages = Math.min(doc.numPages, maxPages);
        // mergePages:false returns per-page strings so the page cap is a
        // real bound on work, not a post-hoc slice.
        const { text } = await extractText(doc, { mergePages: false });
        const chosen = Array.isArray(text) ? text.slice(0, pages) : [String(text)];
        let out = "";
        for (const part of chosen) {
          out += (out ? "\n" : "") + part;
          if (out.length >= MAX_CHARS) break;
        }
        return out;
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
  }
}
