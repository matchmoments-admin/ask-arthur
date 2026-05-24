// ABN checksum validator — pure utility for verifying an 11-digit
// Australian Business Number against its mod-89 weighting checksum.
//
// Split out of `abn-extract.ts` so client code can validate ABN strings
// without dragging in the (server-only) HTTP-fetch chain (`fetchShopPage`
// → `ssrf-dispatcher` → `node:dns`). `charity-intent.ts` is the
// trigger: it runs in `ScamChecker.tsx` (a client component), and the
// Turbopack chunker pulls every static import in the chain — even
// tree-shakeable function-level dead code — when it can't statically
// verify side-effect-freeness across the module boundary.

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * Validate an 11-digit ABN string against the ATO's mod-89 weighting
 * checksum. Returns true only when the input is exactly 11 digits AND
 * passes the checksum — phone-shaped, padded, or truncated inputs fail.
 *
 * Subtract 1 from the first digit before weighting (the ATO rule).
 */
export function isValidAbnChecksum(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += d * ABN_WEIGHTS[i]!;
  }
  return sum % 89 === 0;
}
