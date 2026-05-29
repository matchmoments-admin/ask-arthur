// SSRF-safe undici dispatcher — closes the DNS-rebinding TOCTOU window
// inherent in `fetch()`, where syntactic URL checks (see
// `safebrowsing.isPrivateURL`) can be bypassed by:
//
//   1. A hostname that A-records to a private IP. The syntactic check
//      sees "rebind.example.com" and lets it through; `fetch()` resolves
//      DNS and dials `127.0.0.1`.
//   2. DNS rebinding: the hostname resolves to a public IP at check-time
//      and a private IP at the subsequent `fetch()` connect — the classic
//      time-of-check / time-of-use gap.
//
// The fix is to hook undici's per-connection DNS lookup: resolve the host
// inside the lookup callback, validate the resolved IP against
// private/loopback/metadata ranges, and only return success when the IP
// is publicly routable. undici then dials the same IP we validated, so
// check-time and use-time are the same.
//
// Issue: #353. Used by `fetchShopPage` (Deep Shop Check / verifyShopAbnDeep)
// and reused by future outbound fetchers (Phase A Visual Match per #376).

import { lookup as nodeDnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";

// The IP classifier lives in the pure `./private-ip` module (no undici import)
// so `safebrowsing.isPrivateURL` can share the exact same blocklist without
// pulling in this Agent. Re-exported here for the dispatcher's own callers +
// the tests that import `isPrivateIP` from this path.
import { isPrivateIP } from "./private-ip";
export { isPrivateIP } from "./private-ip";

/**
 * Build a `LookupFunction` for `new Agent({ connect: { lookup } })`.
 * Resolves via the injected `dnsLookup`, then rejects when the resolved
 * IP is in any private range. Exposed for testing — production callers
 * use {@link ssrfSafeDispatcher}.
 */
export function buildSsrfLookup(
  dnsLookup: LookupFunction = nodeDnsLookup as LookupFunction,
): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, options, (err, address, family) => {
      if (err) {
        callback(err, "", 0);
        return;
      }

      // Defensive: handle both single-address (the default) and
      // all-addresses forms. undici always passes `all: false` in
      // practice; the array path is for completeness.
      const first =
        typeof address === "string"
          ? address
          : Array.isArray(address) && address.length > 0
            ? address[0]!.address
            : "";

      if (!first || isPrivateIP(first)) {
        const blocked: NodeJS.ErrnoException = new Error(
          `SSRF: ${hostname} resolves to private IP ${first || "<none>"}`,
        );
        blocked.code = "EPRIVATEHOST";
        callback(blocked, "", 0);
        return;
      }

      // Forward the address undici asked for — single string or array —
      // unmodified. undici will dial this exact IP; we already validated.
      callback(null, address, family ?? 4);
    });
  };
}

/**
 * Singleton SSRF-safe undici dispatcher. Pass as `dispatcher: ssrfSafeDispatcher`
 * to any `fetch()` that retrieves attacker-controlled content. Closes both
 * the DNS-rebinding TOCTOU window and the hostname→private-IP class of
 * attacks that the syntactic `isPrivateURL` check cannot catch.
 */
export const ssrfSafeDispatcher = new Agent({
  connect: { lookup: buildSsrfLookup() },
});
