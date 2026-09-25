// security.txt check — validate RFC 9116 security policy file

import { FETCH_DEFAULT_MAX_REDIRECTS, safeFetch } from "@askarthur/scam-engine/safe-fetch";
import type { CheckResult } from "../types";

const FETCH_TIMEOUT_MS = 3000;
/** RFC 9116 files are a few hundred bytes; read at most this much. */
const MAX_BYTES = 64 * 1024;

/** Check for a valid /.well-known/security.txt file (RFC 9116) */
export async function checkSecurityTxt(baseUrl: string): Promise<CheckResult> {
  try {
    const url = new URL("/.well-known/security.txt", baseUrl).href;

    const res = await safeFetch(url, {
      method: "GET",
      redirect: "follow-checked",
      // Was a plain redirect: "follow" — keep fetch's hop limit.
      maxRedirects: FETCH_DEFAULT_MAX_REDIRECTS,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      truncate: true,
      as: "text",
    });
    // Any non-HTTP failure (timeout, network, blocked) is "could not check".
    if (!res.ok && res.reason !== "http") throw new Error(res.detail);

    if (!res.ok) {
      // Don't penalize absence — just skip
      return {
        id: "security-txt",
        category: "server",
        label: "security.txt",
        status: "skipped",
        score: 0,
        maxScore: 3,
        details: "No security.txt file found. Consider adding one for security researchers.",
      };
    }

    const text = res.body;

    // Validate RFC 9116 required fields
    const hasContact = /^Contact:/im.test(text);
    const hasExpires = /^Expires:/im.test(text);

    if (!hasContact) {
      return {
        id: "security-txt",
        category: "server",
        label: "security.txt",
        status: "warn",
        score: 1,
        maxScore: 3,
        details: "security.txt exists but is missing the required Contact: field (RFC 9116).",
      };
    }

    const details = hasExpires
      ? "security.txt found with Contact and Expires fields (RFC 9116 compliant)."
      : "security.txt found with Contact field. Consider adding an Expires field.";

    return {
      id: "security-txt",
      category: "server",
      label: "security.txt",
      status: "pass",
      score: 3,
      maxScore: 3,
      details,
    };
  } catch {
    return {
      id: "security-txt",
      category: "server",
      label: "security.txt",
      status: "skipped",
      score: 0,
      maxScore: 3,
      details: "Could not check security.txt (request failed).",
    };
  }
}
