// Client-side document-check submission — the ONE fetch/error path shared by
// the standalone /document-check page and the homepage ScamChecker's
// document mode, so the error semantics can't drift between surfaces:
// - !res.ok → the route's message (rate-limit 429, outage 503, invalid file);
// - checked:false (scan_unavailable) → DOCUMENT_CHECK_UNAVAILABLE_COPY —
//   a scan that did not run is NOT the clean state (asymmetry rule).
//
// `surface` rides as a form field so the route's telemetry can separate the
// standalone-page funnel from the inline-scanner funnel.

import {
  DOCUMENT_CHECK_UNAVAILABLE_COPY,
  type WebDocumentCheckResponse,
} from "@askarthur/types";

/** Mirrors the route's MAX_UPLOAD_BYTES — checked client-side so an
 *  oversized file fails instantly instead of after the upload. */
export const DOCUMENT_MAX_UPLOAD_BYTES = 10_000_000;

export type DocumentCheckOutcome =
  | { ok: true; result: WebDocumentCheckResponse }
  | { ok: false; message: string };

export async function submitDocumentCheckFile(
  file: File,
  surface: "web" | "inline",
): Promise<DocumentCheckOutcome> {
  if (file.size > DOCUMENT_MAX_UPLOAD_BYTES) {
    return { ok: false, message: "That PDF is over 10 MB. Try a smaller export." };
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
