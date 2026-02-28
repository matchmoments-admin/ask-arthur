// Domain blacklist check — DNS-based RBL lookups (zero API cost)

import * as dns from "node:dns";
import type { CheckResult } from "../types";

const DNS_TIMEOUT_MS = 3000;

const RBL_SERVERS = [
  { host: "dbl.spamhaus.org", label: "Spamhaus DBL" },
  { host: "multi.surbl.org", label: "SURBL" },
  { host: "black.uribl.com", label: "URIBL" },
  { host: "rhsbl.sorbs.net", label: "SORBS RHSBL" },
  { host: "dnsbl.abuse.ch", label: "abuse.ch" },
];

/** Check a single RBL — A record returned means listed */
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
    // A record returned = domain is listed
    return { listed: result.length > 0, label: rbl.label };
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

  if (listed.length > 0) {
    return {
      id: "domain-blacklist",
      category: "server",
      label: "Domain Blacklist",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Domain is listed on ${listed.length} blacklist${listed.length > 1 ? "s" : ""}: ${listed.join(", ")}.`,
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
