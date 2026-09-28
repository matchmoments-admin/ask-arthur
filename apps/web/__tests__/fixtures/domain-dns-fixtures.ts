import type { DnsAnswers, DnsLookup } from "@/lib/clone-watch/liveness";

/**
 * Shared DNS answer fixtures for the Domain DNS State pin
 * (domainDnsState.test.ts). Each is a shape the resolver really returns;
 * `ns_no_address` is the defect case (NS answers, no A/AAAA — prod ids 2761,
 * 3081, 1385, 3907, 3952 on 2026-09-28).
 */
const rec = (...records: string[]): DnsLookup => ({ records });
const err = (errorCode: string): DnsLookup => ({ errorCode });

export const DNS_FIXTURES: Record<string, DnsAnswers | null> = {
  resolves: { a: rec("192.0.2.10"), aaaa: null, ns: rec("ns1.host.example", "ns2.host.example") },
  ns_no_address: { a: err("ENODATA"), aaaa: err("ENODATA"), ns: rec("ns1.registrar.example") },
  ns_no_address_empty: { a: rec(), aaaa: rec(), ns: rec("ns1.registrar.example") },
  gone: { a: err("ENOTFOUND"), aaaa: err("ENOTFOUND"), ns: err("ENOTFOUND") },
  servfail: { a: err("ESERVFAIL"), aaaa: err("ESERVFAIL"), ns: err("ESERVFAIL") },
  timeout: { a: err("ETIMEOUT"), aaaa: err("ETIMEOUT"), ns: err("ETIMEOUT") },
  parked_resolves: { a: rec("13.248.169.48", "76.223.54.146"), aaaa: null, ns: rec("ns1.afternic.com", "ns2.afternic.com") },
  parked_no_address: { a: err("ENODATA"), aaaa: err("ENODATA"), ns: rec("ns1.sedoparking.com") },
  cloudflare: { a: rec("104.16.1.1"), aaaa: null, ns: rec("ada.ns.cloudflare.com") },
  aaaa_only: { a: err("ENODATA"), aaaa: rec("2606:4700:0:0:0:0:0:1"), ns: rec("ns1.host.example") },
  a_gone_ns_servfail: { a: err("ENOTFOUND"), aaaa: err("ENOTFOUND"), ns: err("ESERVFAIL") },
  a_nodata_aaaa_timeout: { a: err("ENODATA"), aaaa: err("ETIMEOUT"), ns: rec("ns1.host.example") },
  ns_failed_resolves: { a: rec("198.51.100.7"), aaaa: null, ns: err("ETIMEOUT") },
  probe_failed: null,
};

/** Stored attribution variants each fixture is read with. */
export const ATTRIBUTIONS: Record<string, unknown> = {
  none: null,
  hold: { whois: { statuses: ["client transfer prohibited", "client hold"] } },
  parking_ns_stored: { whois: { nameServers: ["ns1.dan.com"] } },
};
