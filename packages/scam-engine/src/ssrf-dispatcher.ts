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
import { isIP, type LookupFunction } from "node:net";
import { Agent, buildConnector } from "undici";

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

      // Validate EVERY address. With autoSelectFamily (the Node 20+ default)
      // undici asks for all addresses (`all: true`) and may dial any of them
      // — e.g. the second after the first times out — so checking only the
      // first would let a mixed answer reach a private host. A mixed answer
      // is itself hostile: refuse it rather than filter it.
      const all: string[] =
        typeof address === "string"
          ? [address]
          : Array.isArray(address)
            ? address.map((a) => a.address)
            : [];
      const bad = all.length === 0 ? "<none>" : all.find((a) => !a || isPrivateIP(a));

      if (bad !== undefined) {
        const blocked: NodeJS.ErrnoException = new Error(
          `SSRF: ${hostname} resolves to private IP ${bad || "<none>"}`,
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

/** Strip IPv6 brackets; return the literal when `host` is an IP, else null. */
function ipLiteral(host: string): string | null {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  return isIP(bare) ? bare : null;
}

/**
 * Wrap an undici connector so an IP-LITERAL host is checked too. The DNS
 * `lookup` hook above only runs for names: Node's socket connect skips
 * resolution entirely when the host is already an IP, so without this a
 * URL (or a followed redirect) naming a private IP directly would connect.
 * Exposed for testing.
 */
export function buildSsrfConnector(
  base: buildConnector.connector = buildConnector({ lookup: buildSsrfLookup() }),
): buildConnector.connector {
  return (options, callback) => {
    const literal = ipLiteral(options.hostname);
    if (literal && isPrivateIP(literal)) {
      const blocked: NodeJS.ErrnoException = new Error(
        `SSRF: ${options.hostname} is a private IP`,
      );
      blocked.code = "EPRIVATEHOST";
      callback(blocked, null);
      return;
    }
    return base(options, callback);
  };
}

/**
 * Singleton SSRF-safe undici dispatcher. Pass as `dispatcher: ssrfSafeDispatcher`
 * to any `fetch()` that retrieves attacker-controlled content. Closes both
 * the DNS-rebinding TOCTOU window and the hostname→private-IP class of
 * attacks that the syntactic `isPrivateURL` check cannot catch.
 */
export const ssrfSafeDispatcher = new Agent({
  connect: buildSsrfConnector(),
});
