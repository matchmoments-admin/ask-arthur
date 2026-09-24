// PDF text extraction — the content layer's input seam.
//
// This is the Document Check Module's ONE deliberate exception to the
// no-parser-deps rule (metadata-origin.ts doctrine): extracting text needs
// Flate inflation and CID font maps, which is a multi-month project to
// hand-roll. It runs under strict containment:
// - only AFTER the dependency-free structural walk admitted the file;
// - a hard timeout;
// - page and character caps, enforced while reading (page by page);
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

/** The slice of pdfjs's document proxy this module uses — narrow so tests can
 *  drive `readPdfPages` with a fake. */
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{
    // pdfjs mixes text items with marked-content items (no `str`).
    getTextContent(): Promise<{ items: ReadonlyArray<object> }>;
    cleanup?(): unknown;
  }>;
}

/**
 * Read text page by page — at most `maxPages` pages and `maxChars`
 * characters, stopping early once either bound is hit or `shouldStop()` turns
 * true (the timeout). unpdf's `extractText` reads EVERY page before returning,
 * so capping its result afterwards did not bound the work.
 */
export async function readPdfPages(
  doc: PdfDocLike,
  maxPages: number,
  maxChars: number = MAX_CHARS,
  shouldStop: () => boolean = () => false,
): Promise<string> {
  const pages = Math.min(doc.numPages, maxPages);
  let out = "";
  for (let i = 1; i <= pages; i++) {
    if (shouldStop()) break;
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      const t = item as { str?: unknown; hasEOL?: unknown };
      if (typeof t.str !== "string") continue;
      text += t.str + (t.hasEOL ? "\n" : "");
    }
    page.cleanup?.();
    out += (out ? "\n" : "") + text;
    if (out.length >= maxChars) break;
  }
  return out;
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
  let timedOut = false;
  let loadingTask: { destroy(): Promise<void> } | undefined;
  try {
    const { getDocumentProxy } = await import("unpdf");

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("pdf_text_timeout"));
      }, timeoutMs);
    });

    const extracted = await Promise.race([
      (async () => {
        // Copy: the parser may transfer/detach the buffer it is given.
        const doc = await getDocumentProxy(new Uint8Array(buffer));
        loadingTask = doc.loadingTask;
        // Page by page, so the page cap and the timeout bound the work
        // itself rather than trimming a result that was fully computed.
        return readPdfPages(doc, maxPages, MAX_CHARS, () => timedOut);
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
    // Release the parser's resources (and abort any in-flight page work after
    // a timeout) — a raced promise alone does not stop the work.
    if (loadingTask) await loadingTask.destroy().catch(() => undefined);
  }
}
