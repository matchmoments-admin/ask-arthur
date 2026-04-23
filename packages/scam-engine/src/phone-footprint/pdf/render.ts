// Server-side PDF render helper. Wraps @react-pdf/renderer's
// renderToBuffer() so callers get a Buffer ready for R2 upload.
//
// Runs on the Node runtime only (react-pdf uses node streams). The API
// route enqueues an Inngest event; the Inngest function calls this helper
// then uploads to R2 — heavy PDF rendering stays off the Next.js request
// path so response times don't degrade.

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import type { Footprint } from "../types";
import { FootprintPdf } from "./template";

export async function renderFootprintPdf(
  footprint: Footprint,
  opts: { recipientEmail?: string } = {},
): Promise<Buffer> {
  // FootprintPdf's root is a <Document>, but TS can't infer the narrow
  // `ReactElement<DocumentProps>` shape renderToBuffer requires from a
  // custom component signature. Cast through unknown to avoid the
  // prop-shape mismatch — safe because the runtime root is always a
  // Document (see template.tsx).
  const element = React.createElement(FootprintPdf, {
    footprint,
    recipientEmail: opts.recipientEmail,
  }) as unknown as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
