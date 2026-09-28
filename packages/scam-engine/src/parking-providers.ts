/**
 * Parking providers — the ONE list of domain-parking / aftermarket hosts.
 *
 * WHY ONE TABLE. Until 2026-09-28 three lists answered "is this parked?" and
 * disagreed: clone-watch's nameserver roots (clone-metrics.ts), the urlscan
 * landing-host patterns (urlscan-classify.ts) and domain intel's nameserver
 * regexes (local-intel.ts — the only one with GoDaddy's domaincontrol.com).
 * Nobody could see the disagreement because no two lists sat side by side.
 *
 * Each entry says WHICH reading counts it, so every reader's set is exactly
 * what it was (pinned by apps/web/__tests__/domainDnsState.test.ts against the old literals).
 * The divergence is now visible in one place instead of fixed in it:
 *
 *   - `cloneWatchNs`  — a clone-watch parking NAMESERVER (was PARKING_NS_ROOTS,
 *     from the 2026-09-22 prod nameserver census). Clone-watch matches a
 *     nameserver against `cloneWatchNs` OR `landingHost` (it always did).
 *   - `landingHost`   — a for-sale LANDING host urlscan ends on (was
 *     PARKED_HOST_PATTERNS).
 *   - `domainIntel`   — the generic domain-intel reading (was
 *     PARKING_NS_PATTERNS). It alone counts domaincontrol.com — GoDaddy's
 *     DEFAULT nameservers, which front live sites as often as parked ones (221
 *     clone alerts carry it, 2026-09-28) — and parklogic.com (5 alerts).
 *     Adopting either for clone-watch moves those rows' stock status, so it is
 *     a decision, not a refactor.
 *
 * Matching is by DNS-label suffix (host === root, or ends with "." + root), so
 * `evilafternic.com.attacker.com` never matches `afternic.com` (ultrareview
 * F8). local-intel's regexes were end-anchored without the dot boundary
 * (`/above\.com$/` also matched `xabove.com`); the suffix rule is strictly
 * tighter and a real parking nameserver always sits under its root.
 *
 * Pure, dependency-free: apps/web (clone-watch liveness.ts) and this package
 * (local-intel.ts) both read it.
 */

export interface ParkingProvider {
  root: string;
  cloneWatchNs?: true;
  landingHost?: true;
  domainIntel?: true;
}

export const PARKING_PROVIDERS: readonly ParkingProvider[] = [
  { root: "afternic.com", cloneWatchNs: true, landingHost: true },
  { root: "dns-parking.com", cloneWatchNs: true },
  { root: "sedoparking.com", cloneWatchNs: true, landingHost: true, domainIntel: true },
  { root: "sedo.com", landingHost: true },
  { root: "parkingcrew.net", cloneWatchNs: true, landingHost: true, domainIntel: true },
  { root: "bodis.com", cloneWatchNs: true, landingHost: true, domainIntel: true },
  { root: "abovedomains.com", cloneWatchNs: true },
  { root: "above.com", cloneWatchNs: true, domainIntel: true },
  { root: "aftermarket.pl", cloneWatchNs: true },
  { root: "namebrightdns.com", cloneWatchNs: true },
  { root: "namebright.com", landingHost: true },
  { root: "dan.com", cloneWatchNs: true, landingHost: true },
  { root: "undeveloped.com", cloneWatchNs: true, landingHost: true, domainIntel: true },
  { root: "uniregistry.com", landingHost: true },
  { root: "domainmarket.com", landingHost: true },
  { root: "parklogic.com", domainIntel: true },
  { root: "domaincontrol.com", domainIntel: true }, // GoDaddy default NS
] as const;

const roots = (pick: (p: ParkingProvider) => boolean | undefined) =>
  PARKING_PROVIDERS.filter(pick).map((p) => p.root);

/** Clone-watch's nameserver reading: a parking NS root or a landing host. */
export const CLONE_WATCH_PARKING_NS: readonly string[] = roots(
  (p) => p.cloneWatchNs || p.landingHost,
);
/** Hosts a for-sale landing page is served from. */
export const PARKING_LANDING_HOSTS: readonly string[] = roots((p) => p.landingHost);
/** The generic domain-intel nameserver reading. */
export const DOMAIN_INTEL_PARKING_NS: readonly string[] = roots((p) => p.domainIntel);

/** DNS-label suffix match; case- and trailing-dot-insensitive. */
export function hostUnder(host: string, list: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return list.some((r) => h === r || h.endsWith("." + r));
}
