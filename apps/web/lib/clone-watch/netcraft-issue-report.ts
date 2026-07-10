import { stripUrlPii } from "@/lib/onward/url-blocklist-report";
import { NETCRAFT_API_BASE, type FalseNegativeCandidate } from "./netcraft-urls";

/**
 * Netcraft "report an issue with a submission" — payload builder + keyless POST.
 *
 * Endpoint: POST /api/v3/submission/{uuid}/report_issue  (NOT /issue — /issue
 * 404s silently and files nothing; report_issue is the real path, verified
 * against Netcraft's live SPA bundle + the akacdev client).
 *
 * The submission's per-URL false negatives (branded lookalikes Netcraft graded
 * "no threats" / "unavailable") are flagged as url_misclassifications so
 * Netcraft re-reviews just those, not the whole (already-malicious) batch.
 *
 * F4 (v221): every candidate now arrives evidence-gated (urlscan
 * likely_phishing OR lifecycle weaponised) and the `reason` cites our urlscan
 * result URL as evidence. The payload has NO screenshot/attachment field —
 * `url_misclassifications` is exactly Array<{reason, url}> per the live SPA
 * bundle (verified 2026-07-10). Confirm against Netcraft API docs + one
 * manual POST before ever adding an attachment key.
 */

export interface NetcraftIssuePayload {
  additional_info: string;
  url_misclassifications: Array<{ reason: string; url: string }>;
  // Sent defensively as [] — the akacdev client treats all three arrays as
  // required; whether the server rejects an empty filename array is confirmed
  // by the first manual POST before go-live.
  filename_misclassifications: string[];
}

const ADDITIONAL_INFO_PREFIX =
  "False negative — brand-impersonation lookalike(s) not actioned. " +
  "The URL(s) flagged below are typosquat/lookalike domains of Australian " +
  "brands, detected via Ask Arthur clone-watch's daily NRD lexical sweep " +
  "(askarthur.au brand watchlist). They appear parked / cloaked / " +
  "pre-weaponisation at scan time (hence the non-malicious grade). Please " +
  "re-review for brand infringement.";

// Netcraft caps additional_info at 10 000 chars — keep the per-URL detail here
// bounded so a full 50-URL batch can never overflow.
const ADDITIONAL_INFO_MAX = 10_000;

/**
 * Build one issue payload for a submission uuid from its branded false-negative
 * candidates. URLs are PII-stripped (query/fragment can carry victim
 * identifiers) before they leave our system.
 */
export function buildIssuePayload(
  candidates: FalseNegativeCandidate[],
): NetcraftIssuePayload {
  const url_misclassifications = candidates.map((c) => ({
    reason:
      `Branded lookalike of ${c.brand}; Netcraft graded this URL ` +
      `"${c.urlState}". Detected via Ask Arthur clone-watch (askarthur.au ` +
      `AU brand watchlist).` +
      evidenceSentence(c),
    url: stripUrlPii(c.candidateUrl),
  }));

  const lines = candidates.map(
    (c) =>
      `• ${stripUrlPii(c.candidateUrl)} — impersonates ${c.brand} (${c.urlState})` +
      (c.urlscanUuid ? ` — urlscan: https://urlscan.io/result/${c.urlscanUuid}/` : ""),
  );
  let additional_info = `${ADDITIONAL_INFO_PREFIX}\n\n${lines.join("\n")}`;
  if (additional_info.length > ADDITIONAL_INFO_MAX) {
    additional_info = additional_info.slice(0, ADDITIONAL_INFO_MAX);
  }

  return { additional_info, url_misclassifications, filename_misclassifications: [] };
}

/** F4 evidence sentence for the per-URL reason. Cites our independent
 *  urlscan verdict (result URL when we hold a uuid — absent on the
 *  reputation-fallback weaponisation path) and, for weaponised clones, the
 *  witnessed parked→live-phishing flip. Factual claims only. */
function evidenceSentence(c: FalseNegativeCandidate): string {
  const parts: string[] = [];
  if (c.urlscanUuid) {
    parts.push(
      ` Our independent urlscan.io scan classified it as likely phishing: ` +
        `https://urlscan.io/result/${c.urlscanUuid}/ .`,
    );
  } else {
    parts.push(
      ` Our independent reputation scan (Google Safe Browsing / VirusTotal) ` +
        `classified it as likely phishing.`,
    );
  }
  if (c.evidence === "weaponised") {
    parts.push(
      ` Re-scan observed it transition from parked/inactive to serving live ` +
        `suspected-phishing content after your original grading.`,
    );
  }
  return parts.join("");
}

export interface NetcraftIssueResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * POST the issue to Netcraft (keyless). Never throws — returns a structured
 * result so the caller can soft-fail (no Inngest fn error / fleet page on a
 * transient Netcraft hiccup).
 */
export async function postNetcraftIssue(
  uuid: string,
  payload: NetcraftIssuePayload,
  timeoutMs = 20_000,
): Promise<NetcraftIssueResult> {
  try {
    const res = await fetch(
      `${NETCRAFT_API_BASE}/submission/${encodeURIComponent(uuid)}/report_issue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
