// PDF text extraction — the content layer's input seam.
//
// This is the Document Check Module's ONE deliberate exception to the
// no-parser-deps rule (metadata-origin.ts doctrine): extracting text needs
// Flate inflation and CID font maps, which is a multi-month project to
// hand-roll. pdfjs-dist is the most-fuzzed PDF parser in existence (it
// ships in Firefox), and it runs here under strict containment:
// - only AFTER the dependency-free structural walk admitted the file;
// - no PostScript-function eval exists to disable — pdfjs-dist 6.x removed
//   the eval path (and its isEvalSupported switch) upstream entirely;
// - a hard timeout that destroys the parse;
// - page and character caps;
// - any failure returns null — the content layer reports "not assessed"
//   (the ADR-0009 unverified discipline), never a finding.

import { logger } from "@askarthur/utils/logger";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PAGES = 20;
const MAX_CHARS = 200_000;

/**
 * pdfjs-dist 6.x references the browser canvas globals (DOMMatrix, Path2D,
 * ImageData) while EVALUATING its module, and tries to polyfill them from
 * `@napi-rs/canvas` — a heavy native dep we deliberately don't install
 * because we extract text and never render. Without it, module load throws
 * `ReferenceError: DOMMatrix is not defined` on the Vercel runtime; our
 * catch turned that into `null`, so the whole AU content layer went
 * silently inert in the deployed bundle while every test passed locally
 * (Node's own globals mask it in dev — measured against a preview
 * deployment 2026-08-23, the ONLY place it reproduces).
 *
 * Text extraction never touches these, so constructible stubs are enough.
 * Guarded by typeof so a real implementation always wins.
 */
function ensureCanvasGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixStub {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
        }
      }
      // pdfjs only constructs these on the render path we never take.
      multiply(): unknown { return this; }
      invertSelf(): unknown { return this; }
      translate(): unknown { return this; }
      scale(): unknown { return this; }
    };
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2DStub {
      addPath(): void {}
      moveTo(): void {}
      lineTo(): void {}
      closePath(): void {}
    };
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageDataStub {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(width = 0, height = 0) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(Math.max(0, width * height * 4));
      }
    };
  }
}

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
    // MUST run before the import — pdfjs touches these while evaluating its
    // module. No unit test can guard this call: extraction succeeds locally
    // without it (Node masks the gap), so only a deployed smoke shows the
    // difference. See docs/ops/document-check-config.md.
    ensureCanvasGlobals();
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
