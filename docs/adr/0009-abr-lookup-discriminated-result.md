# ABR lookup returns a discriminated result; every exception is `lookup-failed`

**Status:** accepted (2026-05-22)

`lookupABN` (`packages/scam-engine/src/abr-lookup.ts`) returns a
discriminated `ABNLookupResult | { ok: false; reason: "not-found" |
"lookup-failed" }` instead of a bare `null`. Every ABR `<exception>`
response — whatever its `exceptionDescription` — maps to `lookup-failed`,
never `not-found`.

## Context

`lookupABN` previously returned `null` for several unrelated outcomes: an
ABN genuinely not on the register, a transient ABR HTTP error, a missing
`ABN_LOOKUP_GUID`, and any thrown error. `verifyShopAbn` mapped every
`null` to the `unregistered` ABN status (+30 risk in the composite score) —
so a transient ABR outage on a legitimate AU shop displaying its real ABN
produced the confident, false claim "ABN not on the register". This was
finding F-A of the 2026-05-22 Deep Shop Check zoom-out (GitHub #349).

The fix has to distinguish "ABR answered, the ABN is not registered" (a
real scam signal) from "the lookup could not complete" (not a signal). The
problem: the ABR `SearchByABNv202001` endpoint returns a 200 with an
`<exception>` body for _both_ a bad/expired GUID _and_ — in some cases — a
search that resolves to no record. The two are only distinguishable by
parsing ABR's free-text `exceptionDescription`, which is brittle and
undocumented.

## Decision

- `lookupABN` returns a discriminated union. Callers distinguish success
  from failure with `"ok" in result`.
- `not-found` is returned **only** for a clean ABR response (no
  `<exception>`) that nonetheless yields no entity name.
- **Every `<exception>` response maps to `lookup-failed`** — the
  conservative choice. `verifyShopAbn` maps `not-found` → `unregistered`
  (+30, a real signal) and `lookup-failed` → the new soft `unverified`
  status (+6, never an accusation).

## Consequences

- A transient ABR error, a bad GUID, or a malformed-ABN exception can
  never again be reported to a user as "ABN unregistered". This is the
  whole point of F-A.
- **Accepted cost:** a genuinely-unregistered ABN that ABR happens to
  surface via an `<exception>` (rather than a clean empty response) is
  scored `unverified` (+6) instead of `unregistered` (+30) — the fake-shop
  signal is softened. This is judged acceptable: a scammer would have to
  craft a checksum-valid-but-unregistered ABN, and the other deep-check
  signals (domain age, APIVoid, commerce flags) still apply. Mis-accusing
  a legitimate shop is the worse error for a consumer-protection product.
- The three `lookupABN` callers (`abn-extract.ts`, the charity-check ABR
  pillar, `/api/abn-lookup`) each handle the discriminated failure.

## Reversal trigger

If real `shop_checks` data shows a meaningful rate of genuinely-fake shops
escaping with a checksum-valid unregistered ABN scored only `unverified`,
revisit by classifying `exceptionDescription` text — mapping the
"no record found" family of ABR exceptions to `not-found` while keeping
GUID / service errors as `lookup-failed`.

## Related

- GitHub #349 — F-A (the conflation bug) and the Plan 1 root-cause diagnosis
- ADR 0008 — Shop Signal deep check is user-initiated
- Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md)
