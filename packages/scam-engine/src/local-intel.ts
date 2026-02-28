// Local intelligence — free enrichment checks using Node.js built-ins + libphonenumber-js.
// No external API calls, no rate limits, no cost. DNS lookups use 3s timeout.

import { Resolver } from "node:dns/promises";
import {
  parsePhoneNumberFromString,
  type PhoneNumber,
} from "libphonenumber-js";
import { logger } from "@askarthur/utils/logger";
import { resolveRedirectChain, isKnownShortener } from "./redirect-resolver";
import { DISPOSABLE_DOMAINS } from "./disposable-domains";

// ── DNS helper ──

const DNS_TIMEOUT_MS = 3_000;

function createResolver(): Resolver {
  return new Resolver();
}

/**
 * Wrap a DNS lookup with a timeout. Returns null on failure (timeout, NXDOMAIN, etc.)
 * and records the check as failed in the tracking arrays.
 */
async function dnsLookup<T>(
  fn: (resolver: Resolver) => Promise<T>,
  checkName: string,
  checksCompleted: string[],
  checksFailed: string[]
): Promise<T | null> {
  const resolver = createResolver();
  try {
    const result = await Promise.race([
      fn(resolver),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), DNS_TIMEOUT_MS)
      ),
    ]);
    checksCompleted.push(checkName);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NXDOMAIN / NODATA are valid "no records found" — still a completed check
    if (msg.includes("ENOTFOUND") || msg.includes("ENODATA")) {
      checksCompleted.push(checkName);
      return null;
    }
    // Timeout or network error — check failed
    checksFailed.push(checkName);
    logger.warn(`DNS lookup failed: ${checkName}`, { error: msg });
    return null;
  }
}

// ── Hosting provider detection ──

const HOSTING_PROVIDERS: { pattern: RegExp; name: string }[] = [
  { pattern: /\.amazonaws\.com$/i, name: "AWS" },
  { pattern: /\.compute\.amazonaws\.com$/i, name: "AWS EC2" },
  { pattern: /\.vultr\.com$/i, name: "Vultr" },
  { pattern: /\.digitalocean\.com$/i, name: "DigitalOcean" },
  { pattern: /\.linode\.com$/i, name: "Linode" },
  { pattern: /\.akamai\.com$/i, name: "Akamai" },
  { pattern: /\.cloudflare\.com$/i, name: "Cloudflare" },
  { pattern: /\.hetzner\.(com|cloud)$/i, name: "Hetzner" },
  { pattern: /\.googleusercontent\.com$/i, name: "Google Cloud" },
  { pattern: /\.bc\.googleusercontent\.com$/i, name: "Google Cloud" },
  { pattern: /\.azure\.com$/i, name: "Azure" },
  { pattern: /\.contabo\.host$/i, name: "Contabo" },
  { pattern: /\.ovh\.(net|com)$/i, name: "OVH" },
  { pattern: /\.scaleway\.com$/i, name: "Scaleway" },
  { pattern: /\.hostgator\.com$/i, name: "HostGator" },
  { pattern: /\.bluehost\.com$/i, name: "Bluehost" },
];

function detectHostingProvider(hostname: string): {
  isHostingProvider: boolean;
  providerName: string | null;
} {
  for (const { pattern, name } of HOSTING_PROVIDERS) {
    if (pattern.test(hostname)) {
      return { isHostingProvider: true, providerName: name };
    }
  }
  return { isHostingProvider: false, providerName: null };
}

// ── Parked domain detection ──

const PARKING_NS_PATTERNS = [
  /sedoparking\.com$/i,
  /parkingcrew\.net$/i,
  /bodis\.com$/i,
  /domaincontrol\.com$/i, // GoDaddy parking
  /above\.com$/i,
  /parklogic\.com$/i,
  /undeveloped\.com$/i,
];

function isParkedDomain(nsRecords: string[]): boolean {
  return nsRecords.some((ns) =>
    PARKING_NS_PATTERNS.some((pattern) => pattern.test(ns))
  );
}

// ── Public API ──

export interface PhoneIntel {
  checksCompleted: string[];
  checksFailed: string[];
  numberType: string | null;
  countryCode: string | null;
  callingCode: string | null;
  carrier: string | null;
  isPossible: boolean;
  isValid: boolean;
  // Placeholder fields for Twilio Lookup v2 integration
  simSwapDetected: boolean | null;
  numberReassigned: boolean | null;
  portedDate: string | null;
}

export async function analyzePhone(e164: string): Promise<PhoneIntel> {
  const checksCompleted: string[] = [];
  const checksFailed: string[] = [];

  let phoneNumber: PhoneNumber | undefined;
  try {
    phoneNumber = parsePhoneNumberFromString(e164);
    checksCompleted.push("phone_parse");
  } catch {
    checksFailed.push("phone_parse");
  }

  if (!phoneNumber) {
    return {
      checksCompleted,
      checksFailed: checksFailed.length ? checksFailed : ["phone_parse"],
      numberType: null,
      countryCode: null,
      callingCode: null,
      carrier: null,
      isPossible: false,
      isValid: false,
      simSwapDetected: null,
      numberReassigned: null,
      portedDate: null,
    };
  }

  checksCompleted.push("phone_validation");

  const numberType = phoneNumber.getType() ?? null;
  const countryCode = phoneNumber.country ?? null;
  const callingCode = phoneNumber.countryCallingCode
    ? `+${phoneNumber.countryCallingCode}`
    : null;

  return {
    checksCompleted,
    checksFailed,
    numberType: numberType as string | null,
    countryCode,
    callingCode,
    carrier: null, // libphonenumber-js doesn't include carrier data in the base metadata
    isPossible: phoneNumber.isPossible(),
    isValid: phoneNumber.isValid(),
    simSwapDetected: null,
    numberReassigned: null,
    portedDate: null,
  };
}

export interface EmailIntel {
  checksCompleted: string[];
  checksFailed: string[];
  hasMX: boolean | null;
  mxHosts: string[];
  hasSPF: boolean | null;
  spfRecord: string | null;
  hasDMARC: boolean | null;
  dmarcRecord: string | null;
  isDisposable: boolean;
  domainExists: boolean | null;
}

export async function analyzeEmail(email: string): Promise<EmailIntel> {
  const checksCompleted: string[] = [];
  const checksFailed: string[] = [];

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return {
      checksCompleted: [],
      checksFailed: ["domain_extract"],
      hasMX: null,
      mxHosts: [],
      hasSPF: null,
      spfRecord: null,
      hasDMARC: null,
      dmarcRecord: null,
      isDisposable: false,
      domainExists: null,
    };
  }

  // Disposable check is instant — no DNS needed
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  checksCompleted.push("disposable_check");

  // Run DNS lookups in parallel
  const [mxResult, txtResult, dmarcResult] = await Promise.all([
    dnsLookup(
      (r) => r.resolveMx(domain),
      "mx_lookup",
      checksCompleted,
      checksFailed
    ),
    dnsLookup(
      (r) => r.resolveTxt(domain),
      "txt_lookup",
      checksCompleted,
      checksFailed
    ),
    dnsLookup(
      (r) => r.resolveTxt(`_dmarc.${domain}`),
      "dmarc_lookup",
      checksCompleted,
      checksFailed
    ),
  ]);

  const hasMX = mxResult !== null ? mxResult.length > 0 : null;
  const mxHosts = (mxResult || [])
    .sort((a, b) => a.priority - b.priority)
    .map((mx) => mx.exchange);

  // SPF: look for TXT record starting with "v=spf1"
  const txtRecords = (txtResult || []).map((chunks) => chunks.join(""));
  const spfRecord = txtRecords.find((r) => r.startsWith("v=spf1")) ?? null;
  const hasSPF = txtResult !== null ? spfRecord !== null : null;

  // DMARC
  const dmarcRecords = (dmarcResult || []).map((chunks) => chunks.join(""));
  const dmarcRecord =
    dmarcRecords.find((r) => r.startsWith("v=DMARC1")) ?? null;
  const hasDMARC = dmarcResult !== null ? dmarcRecord !== null : null;

  // Domain exists if it has any MX records
  const domainExists = hasMX !== null ? hasMX : null;

  return {
    checksCompleted,
    checksFailed,
    hasMX,
    mxHosts,
    hasSPF,
    spfRecord,
    hasDMARC,
    dmarcRecord,
    isDisposable,
    domainExists,
  };
}

export interface DomainIntel {
  checksCompleted: string[];
  checksFailed: string[];
  aRecords: string[];
  aaaaRecords: string[];
  nsRecords: string[];
  mxRecords: string[];
  txtRecords: string[];
  isParked: boolean | null;
}

export async function analyzeDomain(domain: string): Promise<DomainIntel> {
  const checksCompleted: string[] = [];
  const checksFailed: string[] = [];

  const [aResult, aaaaResult, nsResult, mxResult, txtResult] =
    await Promise.all([
      dnsLookup(
        (r) => r.resolve4(domain),
        "a_lookup",
        checksCompleted,
        checksFailed
      ),
      dnsLookup(
        (r) => r.resolve6(domain),
        "aaaa_lookup",
        checksCompleted,
        checksFailed
      ),
      dnsLookup(
        (r) => r.resolveNs(domain),
        "ns_lookup",
        checksCompleted,
        checksFailed
      ),
      dnsLookup(
        (r) => r.resolveMx(domain),
        "mx_lookup",
        checksCompleted,
        checksFailed
      ),
      dnsLookup(
        (r) => r.resolveTxt(domain),
        "txt_lookup",
        checksCompleted,
        checksFailed
      ),
    ]);

  const nsRecords = nsResult || [];
  const isParked = nsResult !== null ? isParkedDomain(nsRecords) : null;

  return {
    checksCompleted,
    checksFailed,
    aRecords: aResult || [],
    aaaaRecords: aaaaResult || [],
    nsRecords,
    mxRecords: (mxResult || [])
      .sort((a, b) => a.priority - b.priority)
      .map((mx) => mx.exchange),
    txtRecords: (txtResult || []).map((chunks) => chunks.join("")),
    isParked,
  };
}

export interface IPIntel {
  checksCompleted: string[];
  checksFailed: string[];
  ptrHostname: string | null;
  hasForwardMatch: boolean | null;
  isHostingProvider: boolean;
  providerName: string | null;
}

export async function analyzeIP(ip: string): Promise<IPIntel> {
  const checksCompleted: string[] = [];
  const checksFailed: string[] = [];

  // Reverse DNS lookup
  const ptrResult = await dnsLookup(
    (r) => r.reverse(ip),
    "ptr_lookup",
    checksCompleted,
    checksFailed
  );

  const ptrHostname = ptrResult?.[0] ?? null;
  let hasForwardMatch: boolean | null = null;
  let isHostingProvider = false;
  let providerName: string | null = null;

  if (ptrHostname) {
    // Forward-confirmed reverse DNS: does the PTR hostname resolve back to this IP?
    const forwardResult = await dnsLookup(
      (r) => r.resolve4(ptrHostname),
      "fcrdns_lookup",
      checksCompleted,
      checksFailed
    );

    if (forwardResult !== null) {
      hasForwardMatch = forwardResult.includes(ip);
    }

    // Hosting provider detection
    const provider = detectHostingProvider(ptrHostname);
    isHostingProvider = provider.isHostingProvider;
    providerName = provider.providerName;
  }

  return {
    checksCompleted,
    checksFailed,
    ptrHostname,
    hasForwardMatch,
    isHostingProvider,
    providerName,
  };
}

export interface URLIntel {
  checksCompleted: string[];
  checksFailed: string[];
  finalUrl: string;
  hopCount: number;
  isShortened: boolean;
  hasOpenRedirect: boolean;
  redirectChain: { url: string; statusCode: number; latencyMs: number }[];
  error: string | null;
}

export async function analyzeURL(url: string): Promise<URLIntel> {
  const checksCompleted: string[] = [];
  const checksFailed: string[] = [];

  try {
    const chain = await resolveRedirectChain(url, {
      maxHops: 10,
      perHopTimeoutMs: 5_000,
      totalTimeoutMs: 15_000, // Tighter total timeout for enrichment context
    });
    checksCompleted.push("redirect_resolution");

    return {
      checksCompleted,
      checksFailed,
      finalUrl: chain.finalUrl,
      hopCount: chain.hopCount,
      isShortened: chain.isShortened,
      hasOpenRedirect: chain.hasOpenRedirect,
      redirectChain: chain.hops,
      error: chain.error ?? null,
    };
  } catch (err) {
    checksFailed.push("redirect_resolution");
    const isShortened = isKnownShortener(url);

    return {
      checksCompleted,
      checksFailed,
      finalUrl: url,
      hopCount: 0,
      isShortened,
      hasOpenRedirect: false,
      redirectChain: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
