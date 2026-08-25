import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DOCUMENT_CHECK_NOT_PDF_COPY,
  DOCUMENT_CHECK_OVERSIZE_COPY,
  DOCUMENT_CHECK_UNAVAILABLE_COPY,
} from "@askarthur/types";
import {
  DOCUMENT_MAX_UPLOAD_BYTES,
  looksLikePdf,
  submitDocumentCheckFile,
} from "@/lib/documentCheckClient";

// The ONE client submit path shared by /document-check and the homepage
// scanner's document mode. Load-bearing: scan-didn't-run is NEVER surfaced
// as a result (asymmetry rule), and the surface discriminator rides the
// form body.

function pdfFile(size = 1000, name = "doc.pdf"): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitDocumentCheckFile", () => {
  it("rejects oversized files locally with the shared copy — no request made", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await submitDocumentCheckFile(pdfFile(DOCUMENT_MAX_UPLOAD_BYTES + 1), "web");
    expect(out).toEqual({ ok: false, message: DOCUMENT_CHECK_OVERSIZE_COPY });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("MIME is a hint: octet-stream with a .pdf name passes; a JPEG is rejected visibly", async () => {
    // Android/cloud pickers report PDFs as octet-stream — the server's
    // magic bytes decide, so the client must let it through.
    expect(
      looksLikePdf(new File([""], "payslip.PDF", { type: "application/octet-stream" })),
    ).toBe(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await submitDocumentCheckFile(
      new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" }),
      "web",
    );
    expect(out).toEqual({ ok: false, message: DOCUMENT_CHECK_NOT_PDF_COPY });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags 429 as rateLimited so callers can render their rate-limit state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "Too many checks. Try again later." }), {
          status: 429,
        }),
      ),
    );
    const out = await submitDocumentCheckFile(pdfFile(), "inline");
    expect(out).toEqual({
      ok: false,
      message: "Too many checks. Try again later.",
      rateLimited: true,
    });
  });

  it("sends the surface discriminator in the form body", async () => {
    let sentSurface: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentSurface = (init.body as FormData).get("surface");
        return new Response(
          JSON.stringify({ checked: true, findings: [], content: null }),
          { status: 200 },
        );
      }),
    );
    const out = await submitDocumentCheckFile(pdfFile(), "inline");
    expect(sentSurface).toBe("inline");
    expect(out.ok).toBe(true);
  });

  it("surfaces the route's message on non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: "rate_limited", message: "Too many checks. Try again later." }),
          { status: 429 },
        ),
      ),
    );
    const out = await submitDocumentCheckFile(pdfFile(), "web");
    expect(out).toEqual({
      ok: false,
      message: "Too many checks. Try again later.",
      rateLimited: true,
    });
  });

  it("maps checked:false to the could-not-run copy — never a result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ checked: false, reason: "scan_unavailable" }),
          { status: 200 },
        ),
      ),
    );
    const out = await submitDocumentCheckFile(pdfFile(), "web");
    expect(out).toEqual({ ok: false, message: DOCUMENT_CHECK_UNAVAILABLE_COPY });
  });

  it("network failure degrades to a friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const out = await submitDocumentCheckFile(pdfFile(), "web");
    expect(out.ok).toBe(false);
  });
});
