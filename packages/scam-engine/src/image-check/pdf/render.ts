// Server-side render helper for the image-check evidence PDF. Unlike the
// phone-footprint PDF (heavy, emailed, rendered in Inngest + stored in R2),
// this is ONE A4 page rendered synchronously in the route handler — Node
// runtime, sub-second, nothing stored.

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { ImageCheckEvidencePdf, type ImageCheckEvidence } from "./template";

export type { ImageCheckEvidence };

export async function renderEvidencePdf(evidence: ImageCheckEvidence): Promise<Buffer> {
  // Same cast rationale as phone-footprint/pdf/render.ts: the runtime root
  // is always a <Document>, but TS can't narrow a custom component to
  // ReactElement<DocumentProps>.
  const element = React.createElement(ImageCheckEvidencePdf, {
    evidence,
  }) as unknown as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
