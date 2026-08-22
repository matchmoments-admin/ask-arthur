// Client-side document-check submission — the ONE fetch/error path shared by
// the standalone /document-check page and the homepage ScamChecker's
// document mode, so the error semantics can't drift between surfaces:
// - file-type + size pre-checks HERE (visible errors on both surfaces; MIME
//   is unreliable — Android/cloud pickers report PDFs as octet-stream — so
//   a .pdf filename also passes; the server's %PDF- magic bytes decide);
// - !res.ok → the route's message (429 flagged separately so callers can
//   render their rate-limit state instead of a generic error);
// - checked:false (scan_unavailable) → DOCUMENT_CHECK_UNAVAILABLE_COPY —
//   a scan that did not run is NOT the clean state (asymmetry rule).
//
// `surface` rides as a form field so the route's telemetry can separate the
// standalone-page funnel from the inline-scanner funnel.

import {
  DOCUMENT_CHECK_MAX_UPLOAD_BYTES,
  DOCUMENT_CHECK_NOT_PDF_COPY,
  DOCUMENT_CHECK_OVERSIZE_COPY,
  DOCUMENT_CHECK_UNAVAILABLE_COPY,
  type WebDocumentCheckResponse,
} from "@askarthur/types";

/** Re-exported for callers' pre-checks — single source in @askarthur/types. */
export const DOCUMENT_MAX_UPLOAD_BYTES = DOCUMENT_CHECK_MAX_UPLOAD_BYTES;

/** MIME is a hint, not truth: accept the PDF type OR a .pdf name and let
 *  the server's magic-byte check decide. */
export function looksLikePdf(file: File): boolean {
  return (
    file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  );
}

export type DocumentCheckOutcome =
  | { ok: true; result: WebDocumentCheckResponse }
  | { ok: false; message: string; rateLimited?: boolean };

export async function submitDocumentCheckFile(
  file: File,
  surface: "web" | "inline",
): Promise<DocumentCheckOutcome> {
  if (!looksLikePdf(file)) {
    return { ok: false, message: DOCUMENT_CHECK_NOT_PDF_COPY };
  }
  if (file.size > DOCUMENT_CHECK_MAX_UPLOAD_BYTES) {
    return { ok: false, message: DOCUMENT_CHECK_OVERSIZE_COPY };
  }
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("surface", surface);
    const res = await fetch("/api/document-check", { method: "POST", body: form });
    const data = (await res.json()) as WebDocumentCheckResponse & {
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: data.message ?? "Couldn't check this document. Try again later.",
        rateLimited: res.status === 429,
      };
    }
    if (!data.checked) {
      return { ok: false, message: DOCUMENT_CHECK_UNAVAILABLE_COPY };
    }
    return { ok: true, result: data };
  } catch {
    return { ok: false, message: "Couldn't check this document. Try again later." };
  }
}
