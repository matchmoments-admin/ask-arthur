// Email security checks — SPF, DMARC, DKIM via DNS TXT lookups (zero API cost)

import * as dns from "node:dns";
import type { CheckResult } from "../types";

const DNS_TIMEOUT_MS = 3000;

// Common DKIM selectors used by major email providers
const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "k1"];

/** Resolve TXT records with a timeout, returning empty array on failure */
async function resolveTxtSafe(
  hostname: string,
  timeoutMs: number = DNS_TIMEOUT_MS
): Promise<string[]> {
  return Promise.race([
    dns.promises
      .resolveTxt(hostname)
      .then((records) => records.map((r) => r.join(""))),
    new Promise<string[]>((_, reject) =>
      setTimeout(() => reject(new Error("DNS timeout")), timeoutMs)
    ),
  ]).catch(() => []);
}

/** Resolve A records with a timeout, returning empty array on failure */
async function resolveASafe(
  hostname: string,
  timeoutMs: number = DNS_TIMEOUT_MS
): Promise<string[]> {
  return Promise.race([
    dns.promises.resolve4(hostname),
    new Promise<string[]>((_, reject) =>
      setTimeout(() => reject(new Error("DNS timeout")), timeoutMs)
    ),
  ]).catch(() => []);
}

/** Check SPF record for a domain */
async function checkSPF(domain: string): Promise<CheckResult> {
  const records = await resolveTxtSafe(domain);
  const spfRecord = records.find((r) => r.startsWith("v=spf1"));

  if (spfRecord) {
    return {
      id: "spf",
      category: "email",
      label: "SPF Record",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: `SPF record found: ${spfRecord.length > 100 ? spfRecord.slice(0, 100) + "..." : spfRecord}`,
    };
  }

  return {
    id: "spf",
    category: "email",
    label: "SPF Record",
    status: "fail",
    score: 0,
    maxScore: 3,
    details: "No SPF record found. Email spoofing is possible for this domain.",
  };
}

/** Check DMARC record for a domain */
async function checkDMARC(domain: string): Promise<CheckResult> {
  const records = await resolveTxtSafe(`_dmarc.${domain}`);
  const dmarcRecord = records.find((r) => r.startsWith("v=DMARC1"));

  if (!dmarcRecord) {
    return {
      id: "dmarc",
      category: "email",
      label: "DMARC Policy",
      status: "fail",
      score: 0,
      maxScore: 4,
      details:
        "No DMARC record found. The domain has no policy for handling spoofed email.",
    };
  }

  // Extract the p= policy
  const policyMatch = dmarcRecord.match(/;\s*p=(\w+)/i);
  const policy = policyMatch?.[1]?.toLowerCase() || "none";

  if (policy === "reject") {
    return {
      id: "dmarc",
      category: "email",
      label: "DMARC Policy",
      status: "pass",
      score: 4,
      maxScore: 4,
      details: 'DMARC policy set to "reject" — spoofed emails will be rejected.',
    };
  }

  if (policy === "quarantine") {
    return {
      id: "dmarc",
      category: "email",
      label: "DMARC Policy",
      status: "warn",
      score: 2,
      maxScore: 4,
      details:
        'DMARC policy set to "quarantine" — spoofed emails may be flagged. Consider upgrading to "reject".',
    };
  }

  // policy === "none" or unrecognized
  return {
    id: "dmarc",
    category: "email",
    label: "DMARC Policy",
    status: "warn",
    score: 2,
    maxScore: 4,
    details:
      'DMARC policy set to "none" — spoofed emails are monitored but not blocked. Consider upgrading to "reject".',
  };
}

/** Check DKIM by probing common selectors */
async function checkDKIM(domain: string): Promise<CheckResult> {
  const found: string[] = [];

  const checks = DKIM_SELECTORS.map(async (selector) => {
    const hostname = `${selector}._domainkey.${domain}`;
    // Try TXT first (standard DKIM), then CNAME (delegated DKIM)
    const txtRecords = await resolveTxtSafe(hostname);
    if (txtRecords.some((r) => r.includes("v=DKIM1") || r.includes("k=rsa"))) {
      found.push(selector);
      return;
    }
    // Some providers use CNAME for DKIM delegation
    const aRecords = await resolveASafe(hostname);
    if (aRecords.length > 0) {
      found.push(selector);
    }
  });

  await Promise.allSettled(checks);

  if (found.length > 0) {
    return {
      id: "dkim",
      category: "email",
      label: "DKIM Signing",
      status: "pass",
      score: 3,
      maxScore: 3,
      details: `DKIM record found for selector${found.length > 1 ? "s" : ""}: ${found.join(", ")}.`,
    };
  }

  return {
    id: "dkim",
    category: "email",
    label: "DKIM Signing",
    status: "warn",
    score: 1,
    maxScore: 3,
    details:
      "No DKIM records found for common selectors. DKIM may use a custom selector not checked here.",
  };
}

/** Run all email security checks for a domain */
export async function checkEmailSecurity(
  domain: string
): Promise<CheckResult[]> {
  const [spf, dmarc, dkim] = await Promise.all([
    checkSPF(domain),
    checkDMARC(domain),
    checkDKIM(domain),
  ]);

  return [spf, dmarc, dkim];
}
