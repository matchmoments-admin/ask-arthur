# Layer 0 substring-hit gating: scam-context-token requirement

**Status:** accepted (2026-05-24)

The Layer 0 lexical matcher (`packages/shopfront-glue/src/lexical-match.ts`)
emits three signal types — **substring**, **confusable**, and **Levenshtein**.
After the first v1.5 prod run produced ~70% FPs on common-English-word brand
matches (e.g. `bigclash-greece.co` for Reece, `targetsec.com.br` for Target),
the **substring** signal type is now gated by a scam-context-token check on
the brand-stripped residue. **Confusable** and **Levenshtein** stay ungated.
The list of tokens, the two-char-ccTLD drop heuristic, and the
bare-brand-on-wrong-TLD exception are load-bearing choices recorded here.

## Context

PR #397 shipped the v1 matcher (Aho-Corasick brand substrings + Levenshtein
edit-distance + Unicode confusables + punycode). First prod run on
2026-05-24 produced 432 hits — 95% false positives from short-brand
substring noise (137× ANZ matching `franzese.com`, 137× IGA matching
`lanzhoudhl.com`, etc).

PR #403 added a minimum brand length gate (`MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING = 5`):
brands ≥5 chars keep substring-anywhere matching, brands <5 chars must
appear as a standalone segment of the primary label (split by `-_`).
Second prod run produced 17 hits with ~70% FPs — mostly common-English
word collisions on long brands: 3× "Reece" all matching _Greece_
(`bigclash-greece.co`, `greeceexcursion.com`, `spindjinn-greece.net`);
7× "Target" mostly real businesses (`targetsec.com.br`,
`targettcarpentryltd.co.uk`).

The 70% FP rate was incompatible with the public `/clone-watch` page's
factual-signal-only framing — without a token gate, the page would have
landed as "we're flagging real businesses because their names share a
substring with an Australian brand", which is exactly the defamation
exposure ADR-0014 and the disclaimer-pack-v0 principles are designed to
avoid.

BACKLOG.md #27 captured three remediation paths:

1. Scam-context token gate (`bank`, `login`, `support`, `ads`, `online`,
   `secure`, `verify`, `pay`, `home`, etc.) in the brand-stripped residue
2. Voyage embedding similarity between brand-name and candidate label
3. Per-brand exclusion list

Option (a) was selected for PR #408. (b) is Phase C scope (per ADR-0015 —
embeddings are the primary verdict for the "logo-swap, copy-preserved"
attack class, not a Layer 0 substring-gate booster). (c) doesn't generalise
across the long tail of common-word brand collisions.

## Decision

**Substring brand-hits at Layer 0 are gated.** A substring match fires
only when one of these two conditions holds:

1. **Bare-brand-on-wrong-TLD exception.** Primary label IS the brand
   (e.g. `westpac.com`, `commbank.io`, `nab.shop`). These are the highest-
   intent impersonation shape — the registrant chose the bare brand on a
   non-legitimate TLD. Fires without context-token requirement.

2. **Scam-context token requirement.** The brand-stripped residue of the
   primary label contains at least one scam-context token. Token list:

   ```
   bank, login, support, ads, online, secure, verify, pay, home, shop,
   store, account, au
   ```

**Confusable and Levenshtein branches stay ungated.** Different threat
shapes:

- **Confusable** matches are intentional Unicode trickery (Cyrillic `а` in
  `wеstpac.com`). The intent signal is in the character choice itself —
  no legitimate business uses Cyrillic-looking-Latin domains by accident.
- **Levenshtein** with `minLen=5` is already a tight gate: a single-edit
  permutation of a 5+ character brand has a small candidate space, and a
  legitimate business is unlikely to register a single-character
  off-by-one of a major AU brand.

**Two-char-ccTLD drop heuristic.** When building the residue, drop
two-character ccTLD suffixes (`.com.au`, `.co.uk`, `.com.br`, etc.) before
checking for `au` / `uk` / `br` tokens. Without this, every `.com.au`
domain in the NRD universally satisfies the `au` token, defeating the
gate.

## Token list rationale

The 14 tokens were selected from PR #405's recommended Option A — a curated
set of words that recur in real AU phishing/impersonation campaigns
observed in `scam_reports.raw_content` and Reddit Intel themes. The
selection criteria:

- **High recall on observed scam shapes:** `bank` / `login` / `verify` /
  `secure` / `pay` capture credential-harvest framing; `shop` / `store` /
  `online` / `ads` capture commerce-clone framing; `support` / `account`
  capture impersonated-CS framing; `home` captures the Westpac-Home-Loans-
  branded variant seen in v1.5 verification (`westpachomesb.info`).
- **Low precision drag:** none of the tokens fire universally enough on
  legitimate domains to drown out the brand signal. The closest call is
  `au` (legitimate AU businesses often have `au` in the primary label) —
  the two-char-ccTLD drop and the v3 follow-up (#409) address this class.
- **Closed list, no fuzzy expansion.** The list lives in
  `SCAM_CONTEXT_TOKENS` in `packages/shopfront-glue/src/lexical-match.ts`.
  Adding/removing tokens requires a PR + verification re-run; no runtime
  expansion via embeddings or LLM judgement.

## Known FN trade-off

**Short brands without Levenshtein fallback lose context-less substring
hits.** Brands shorter than `MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING=5` (KFC,
ANZ, NAB, IGA, BWS) only fire substring matches when they appear as a
standalone segment of the primary label. With the additional context-token
gate at v2, these short-brand segment hits also need a scam-context token
in the residue.

Concrete miss: `kfc-net.net` — `kfc` is a primary-label segment, but the
residue `net.net` contains no scam-context token, so the substring path
silently drops. v1.5 fired on this; v2 does not.

**Why this is acceptable for Layer 0:** the consumer analyze pipeline
(`/api/analyze`) still catches these via Google Safe Browsing + ABN-Lookup

- Claude red-flag extraction. Layer 0 is a daily public ledger of
  suspicious AU brand-targeting registrations, not the consumer's primary
  defence. Losing the long tail of short-brand-low-context FN is an
  acceptable cost for keeping the FP rate inside the <30% acceptance gate
  that makes the public page credible.

## Known FP class surfaced post-deploy

**The `au` token leaks via plain substring match into mid-word "au-"
prefixes.** Concrete FP from Day-1 verification (2026-05-24): Coles match
on `autoecolesoultbycfconduite.fr` — a French driving school. Primary
label `autoecolesoultbycfconduite` contains `coles` (substring brand hit
on Coles), residue after brand-strip is `autoeoultbycfconduite.fr`, which
contains `au` (mid-word in `auto`) → gate passes → FP.

The same class catches `audio-*`, `australia-*` (without `.au` TLD),
`auction-*`, `aurora-*` etc.

**Tracked as [#409 v3 matcher — word-boundary check for 'au' context
token](https://github.com/matchmoments-admin/ask-arthur/issues/409).**
Fix path (Option A from #409): treat `au` as a segment-only token (must
appear as a primary-label segment after splitting by `-_.`, not embedded
mid-word). Preserves the `westpac-au.com`-style impersonation signal that
motivated including `au` in the list, kills the `auto-*` class.

## Acceptance gate

Layer 0 v2 ships with two coupled gates:

1. **FP rate <30%** on the daily NRD run (eyeball-verified for the first
   7 days, then periodic spot-checks).
2. **Daily hit count ≥3** ("the floor"). Distinguishes a working matcher
   from a silenced one — if v2's gate is so strict that zero hits land,
   it's silently broken even at 0% FP.

Day-1 post-deploy verification (2026-05-24 10:32 UTC): 5 hits / 20% FP
rate / 4 brands → both gates pass.

## Consequences

- **Public `/clone-watch` page renders a 20%-FP-bounded ledger.** Real-
  business names with substring collisions to AU brands no longer surface
  unless they also carry a scam-context token in the residue. Defamation
  exposure drops materially from v1.5's ~70% FP shape.
- **The FP rate ceiling is an acceptance gate.** If a future v3+ matcher
  iteration breaches 30% FP on the next 7 daily runs, it gets reverted —
  the credibility of the public surface depends on the gate holding.
- **`au` is the weakest token in the list.** It earns its place via
  `westpac-au.com`-style impersonations but its mid-word substring leak
  is a known regression class (#409). The fix is mechanical (segment
  boundary check) and ships in v3.
- **Confusable + Levenshtein stay live unconditionally.** These paths are
  not affected by the token gate — `wеstpac.com` (Cyrillic) and
  `westpec.com` (1-edit) still fire without needing a context token. The
  intent signal is in the character pattern, not the residue.
- **The token list is small and curated.** A small set keeps the gate
  predictable. Expansion is a PR-mediated decision; no runtime fuzzy
  expansion. If a new high-recall token emerges from real prod data, it
  goes into `SCAM_CONTEXT_TOKENS` with a verification re-run, not into a
  config file or feature flag.

## Alternatives considered

1. **Voyage embedding distance between brand-name and candidate label.**
   Rejected for Layer 0 — embeddings are the primary verdict for Phase C's
   "logo-swap, copy-preserved" attack class (ADR-0015), not a Layer 0
   substring-gate booster. Wrong layer, wrong cost shape (whoisds free
   tier is A$0/mo; adding Voyage tokens per NRD candidate × per brand
   would blow the `feature_brakes.shopfront_clone_watch` budget for what
   amounts to a token list-equivalent precision check).
2. **Per-brand exclusion list.** Considered — explicit "skip if primary
   label contains `greece`, `coles-creek`, `autoecole`, etc." entries.
   Rejected: doesn't generalise across the long tail of common-word
   collisions, and the exclusion list becomes a maintenance burden that
   grows linearly with corpus. The scam-context-token list is a single
   choice that captures the same precision goal more cleanly.
3. **Drop the substring signal entirely; rely on confusable + Levenshtein.**
   Considered. Rejected: substring is the only signal that catches the
   `westpachomesb.info` shape (brand + suffix word). Levenshtein with a
   single edit doesn't catch concatenated-suffix patterns at distance
   ≥2; confusable doesn't apply to ASCII-only impersonations. Substring
   remains the highest-recall signal — gating it is the right move,
   removing it is not.
4. **Gate confusable and Levenshtein with the same token check.** Rejected.
   Confusable matches are intentional Unicode trickery — the character
   choice itself is the intent signal, so requiring a separate context
   token over-gates a high-precision branch. Levenshtein with `minLen=5`
   already has a small candidate space; adding a token gate would
   suppress legitimate single-edit typo-squat detections like `westpec.com`
   that have no scam-context word in the residue.

## Reversal trigger

If post-deploy data shows the substring gate is materially over-tightening
(e.g. 7 consecutive days under the ≥3 daily-hits floor), revisit either:

- **Lower the brand-length threshold** so more brands keep substring-
  anywhere matching (currently `MIN_BRAND_LEN_FOR_LOOSE_SUBSTRING=5`)
- **Add tokens to the list** based on the missed-TP analysis from the
  daily eyeball pass

Conversely, if the FP rate creeps above 30% as the watchlist grows beyond
~50 brands, the gate tightens — either by shrinking the token list, by
requiring proximity between the token and the brand, or by requiring two
tokens for primary labels longer than N characters.

## Related

- ADR-0015 — clone-detection signal model (deterministic-first; Layer 0
  is deterministic-string only, embeddings are Phase C)
- ADR-0016 — clone-detection source layering (Layer 0 is whoisds NRD +
  static AU brand watchlist; ADR-0017 amends the matcher behaviour, not
  the source layering)
- `packages/shopfront-glue/src/lexical-match.ts` — the implementation
  (`SCAM_CONTEXT_TOKENS` set + the `hasScamContext` helper + the
  two-char-ccTLD drop)
- Issue #405 — the scoping issue that recommended Option A
- PR #408 — the v2 matcher ship
- Issue #409 — v3 follow-up: word-boundary check for `au` token
- `docs/plans/clone-watch-mvp.md` — matcher evolution log
- BACKLOG.md #27 (struck-through post-#408) — original FP problem
  statement + remediation options
