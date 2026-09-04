/**
 * The ONE decoder for the `urlscan_evidence` JSONB shape.
 *
 * Moved out of clone-watch-notify-brand-prepare.ts (an Inngest function that
 * sends brand-alert email) because `toCloneDetail` in clone-metrics.ts depends
 * on it, and that host file's module top-level pulls the Inngest client, the
 * Supabase service client, Resend and @react-email/components. A pure 13-line
 * decoder should not drag an email stack into every reporting Module that
 * decodes a screenshot URL.
 */

export interface UrlscanEvidenceForEmail {
  /** urlscan.io result page — derived from the submission uuid. */
  resultUrl: string;
  /** Screenshot URL. Only present when retrieval succeeded. */
  screenshotUrl?: string;
}

/**
 * Shape raw `urlscan_evidence` JSONB into the display-ready fields.
 *
 * Shape variants seen in prod (2026-05-27):
 *   * `{uuid, retrieved: false, retrieval_timeout: true}` — scan ran,
 *      retrieval timed out; result page still exists at urlscan.io
 *   * `{error, status, submit_failed: true}` — submit rejected (e.g.
 *      DNS-error for parked typosquats). No uuid → no link.
 *   * `{uuid, retrieved: true, screenshot_url, effective_url, ...}` —
 *      full success.
 */
export function urlscanEvidenceFromJsonb(
  raw: unknown,
): UrlscanEvidenceForEmail | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const uuid = typeof obj.uuid === "string" ? obj.uuid : null;
  if (!uuid) return undefined;
  const screenshot =
    typeof obj.screenshot_url === "string" ? obj.screenshot_url : undefined;
  return {
    resultUrl: `https://urlscan.io/result/${uuid}/`,
    screenshotUrl: screenshot,
  };
}
