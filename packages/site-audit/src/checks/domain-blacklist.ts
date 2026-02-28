// Domain blacklist check — DNS-based RBL lookups (zero API cost)

import * as dns from "node:dns";
import type { CheckResult } from "../types";

const DNS_TIMEOUT_MS = 3000;

const RBL_SERVERS = [
  { host: "dbl.spamhaus.org", label: "Spamhaus DBL" },
  { host: "multi.surbl.org", label: "SURBL" },
  { host: "dnsbl.abuse.ch", label: "abuse.ch" },
];

// RBL responses in 127.0.0.x or 127.255.255.x are test/error codes, not real listings.
// Only 127.0.1.x+ (Spamhaus) or 127.0.0.2+ (others) indicate actual listings.
const IGNORED_RESPONSES = new Set(["127.0.0.1", "127.255.255.254", "127.255.255.255"]);

/** Check a single RBL — specific A record ranges indicate a listing */
async function queryRBL(
  domain: string,
  rbl: { host: string; label: string }
): Promise<{ listed: boolean; label: string }> {
  const query = `${domain}.${rbl.host}`;
  try {
    const result = await Promise.race([
      dns.promises.resolve4(query),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT_MS)
      ),
    ]);
    // Filter out test/error responses — only count genuine listings
    const genuine = result.filter((ip) => !IGNORED_RESPONSES.has(ip));
    return { listed: genuine.length > 0, label: rbl.label };
  } catch {
    // ENOTFOUND / ENODATA = not listed, timeout = treat as not listed
    return { listed: false, label: rbl.label };
  }
}

/** Check if domain appears on any DNS-based blacklists */
export async function checkDomainBlacklist(
  domain: string
): Promise<CheckResult> {
  const results = await Promise.allSettled(
    RBL_SERVERS.map((rbl) => queryRBL(domain, rbl))
  );

  const listed: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.listed) {
      listed.push(result.value.label);
    }
  }

  if (listed.length >= 2) {
    return {
      id: "domain-blacklist",
      category: "server",
      label: "Domain Blacklist",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Domain is listed on ${listed.length} blacklists: ${listed.join(", ")}.`,
    };
  }

  if (listed.length === 1) {
    return {
      id: "domain-blacklist",
      category: "server",
      label: "Domain Blacklist",
      status: "warn",
      score: 3,
      maxScore: 5,
      details: `Domain appeared on 1 blacklist (${listed[0]}). This may be a false positive — listed on only 1 of ${RBL_SERVERS.length} checked.`,
    };
  }

  return {
    id: "domain-blacklist",
    category: "server",
    label: "Domain Blacklist",
    status: "pass",
    score: 5,
    maxScore: 5,
    details: `Domain is not listed on any of the ${RBL_SERVERS.length} DNS blacklists checked.`,
  };
}
