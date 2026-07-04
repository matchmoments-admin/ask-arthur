// Review-signal orchestrator — Deep Shop Check Stage 1.
//
// detectAndFetchReviews(html): detect the store's review app from the already
// -fetched page HTML, then dispatch to that app's extractor. Returns a
// normalized ReviewCorpus or a typed ReviewFetchSkip — never throws.
//
// Okendo is live (verified against kouvrfashion.com). Yotpo / Loox / Judge.me
// are detected for coverage telemetry but their extractors are staged pending
// their own live endpoint probe, so they return `unsupported-app`.

import type { ReviewCorpus, ReviewFetchSkip } from "../../reviews-signal";
import { detectReviewApp } from "./detect";
import { fetchOkendoReviews } from "./okendo";

export { detectReviewApp } from "./detect";
export type { DetectedReviewApp } from "./detect";

export async function detectAndFetchReviews(
  html: string,
): Promise<ReviewCorpus | ReviewFetchSkip> {
  const detected = detectReviewApp(html);
  if (!detected) return { ok: false, reason: "no-fingerprint" };
  if (!detected.identifier) return { ok: false, reason: "no-identifier" };

  switch (detected.app) {
    case "okendo":
      return fetchOkendoReviews(detected, html);
    case "yotpo":
    case "loox":
    case "judgeme":
      return { ok: false, reason: "unsupported-app" };
  }
}
