// DNSSEC check — verify DNSKEY records exist for a domain via Google DoH

import type { CheckResult } from "../types";

const DOH_TIMEOUT_MS = 3000;

/** Check if a domain has DNSSEC enabled via Google DNS-over-HTTPS */
export async function checkDNSSEC(domain: string): Promise<CheckResult> {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=DNSKEY`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      headers: { Accept: "application/dns-json" },
    });

    if (!res.ok) {
      return {
        id: "dnssec",
        category: "email",
        label: "DNSSEC",
        status: "error",
        score: 0,
        maxScore: 3,
        details: "Could not query DNSSEC status (DNS resolver error).",
      };
    }

    const data = await res.json();

    // Check if AD (Authenticated Data) flag is set or DNSKEY records exist
    const hasDNSKEY =
      data.AD === true ||
      (Array.isArray(data.Answer) &&
        data.Answer.some((a: { type: number }) => a.type === 48)); // type 48 = DNSKEY

    if (hasDNSKEY) {
      return {
        id: "dnssec",
        category: "email",
        label: "DNSSEC",
        status: "pass",
        score: 3,
        maxScore: 3,
        details: "DNSSEC is enabled — DNS responses are cryptographically signed.",
      };
    }

    return {
      id: "dnssec",
      category: "email",
      label: "DNSSEC",
      status: "fail",
      score: 0,
      maxScore: 3,
      details: "DNSSEC is not enabled. DNS responses could be spoofed.",
    };
  } catch {
    return {
      id: "dnssec",
      category: "email",
      label: "DNSSEC",
      status: "error",
      score: 0,
      maxScore: 3,
      details: "DNSSEC check timed out or failed.",
    };
  }
}
