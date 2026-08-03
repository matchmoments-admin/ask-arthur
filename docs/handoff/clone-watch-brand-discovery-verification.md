# Handoff — clone-watch brand-discovery: verification state

**Written 2026-07-30, closed out 2026-08-03.** Owner of the next session: read
this top to bottom before touching anything. It exists because the honest answer
to "does it work?" was _mostly yes, and here is precisely which parts are proven,
which are not, and how to finish proving them._

**Status: the verification is now COMPLETE.** The unattended Monday run fired on
schedule (§3a-i) and surfaced its first genuinely new brand. Every structural gap
this document opened is closed. What remains is not verification but two pieces of
real work — the matcher gap (§6b, the larger one) and an operator's judgement on
21 pending global brands — plus the standing question no amount of testing can
answer: whether the signal is valuable enough to be worth the weekly digest.

Workstream: PRs **#863–#872** (migrations **v254–v257**) plus follow-ups. All
merged to `main`, all migrations applied to prod project `rquomhcgnodxzkhokwni`.

---

## 1. What the feature is meant to do

The weekly `reddit-brands-discover` cron finds brands that scammers are
impersonating but that the clone-watch matcher does **not** yet watch, ranks
them by Australian relevance, and lets an operator promote one onto the live
matcher in one click (or, behind a flag, promotes it automatically).

Before this workstream: the digest proposed US-only brands (Xfinity, Chime,
Capital One) for an Australian watchlist, the review queue had **no writer at
all** (51 rows, 100% `pending`, one month), and promotion required a
compile-time array edit + PR + deploy — so zero of 51 candidates were ever
promoted.

---

## 2. PROVEN — with the evidence

| Claim                                             | How it was proven                                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost-digest windows are now equal 7-day spans     | 25 vitest cases pinned to real prod `daily_cost_summary` figures, incl. one reproducing the old 8-day sum                                             |
| The overlay merge never yields a domainless brand | v256 `CHECK` + RPC predicate, both exercised live in prod (INSERT rejected, UPDATE rejected, `pending` accepted)                                      |
| Promotion is atomic and reversible                | Full round trip in prod: promote → visible to matcher → demote → invisible, candidate back to `pending`, row retained inactive. All test rows removed |
| Domain normalisation on promote                   | `['HTTPS://WWW.Vinted.com.au/catalog','','vinted.com']` → `['vinted.com','vinted.com.au']` in prod                                                    |
| `FF_BRAND_DYNAMIC_WATCHLIST` is genuinely live    | `pg_stat_statements` shows a `WITH pgrst_source AS (...)` wrapper on `list_active_monitored_brands` — an app call, not ours                           |
| The overlay didn't change matcher behaviour       | First overlay-enabled NRD sweep 2026-07-29: 70,000 scanned / 30 hits / 0 failed chunks, inside the 30–70 pre-flag baseline                            |
| Anti-scrape gate survives the async resolver      | Prod: `%%`, `a%`, `_`, unknown brand all → `monitored:false`; brand/domain/alias forms all resolve                                                    |
| Admin queue is gated                              | `/admin/brand-candidates` → 307 `/admin/login`, no content leak                                                                                       |
| Table invariants                                  | `au_mention_count > mention_count`: 0. jsonb-sum mismatches: 0. Bad statuses: 0. Verified-without-domains: 0                                          |
| Regression                                        | `turbo typecheck` 13/13, `turbo test` 12/12, lint 0 errors, 323 Python                                                                                |

**The production replay harness** —
`apps/web/__tests__/redditBrandsDiscoverProdReplay.test.ts` — is the load-bearing
artifact. It captures the literal output of the production RPCs and replays it
through the real exported functions in the order the cron calls them. 21 cases.
Refresh instructions are in its header.

**Read its limits too.** A replay is only as good as its capture, and the 2026-07-30
second pass found the capture had silently dropped 7 of 45 rows, which was enough
to invert its headline prediction (§3b). Two rules now apply when touching it:
refresh ALL rows from the RPC rather than hand-transcribing, and assert
_properties_ ("no already-covered brand is ever proposed") rather than
point-in-time facts ("both lists are empty") — the latter go stale within hours as
the 30-day window rolls, while reading as though they were invariants.

---

## 3. NOT PROVEN — the honest gaps

### 3a. ~~The cron has never run with this code~~ — RESOLVED 2026-07-30

**Superseded.** After #884 deployed, the manual trigger was fired
(`reddit-brands/discover.manual-trigger.v1`, event `01KYRZ6T42CSFGAWM1A3MHSMC5`)
and the run completed. Measured immediately after:

| Check                              | Before     | After the run                            |
| ---------------------------------- | ---------- | ---------------------------------------- |
| `max(last_seen_at)`                | 2026-07-27 | **2026-07-30 07:36:06**                  |
| rows with `au_mention_count>0`     | **0**      | **3** (eBay 1, Vinted 1, Capital One 1)  |
| rows touched                       | —          | 23 (= the replay's predicted `allFresh`) |
| NEW rows created                   | —          | **0** — nothing net-new, as predicted    |
| `au_mention_count > mention_count` | 0          | 0                                        |
| jsonb `au_counts` sum drift        | 0          | 0                                        |
| promoted                           | 0          | 0 (nothing clears the bar — §3b-i)       |

**The v260 alias is proven end-to-end**, not just in tests: `googleplay` was in
the live aggregate at ≥3 mentions, not denylisted, not in the queue, and
`googleplay ≠ google` — so without the alias it would have been inserted as row
**52**. The table stayed at 51 and `brand_normalized='googleplay'` returns 0 rows.
Exactly one brand suppressed, correctly.

### 3a-i. The unattended run — HAPPENED 2026-08-03 07:01:59 UTC

The last structural gap is closed. The cron fired on schedule, unattended, with
no manual trigger:

| Check                              | Result                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Fired on schedule                  | **Yes** — `07:01:59 UTC`, cron trigger not event trigger |
| Rows touched                       | 22                                                       |
| **NEW rows**                       | **1** — `Mercari` (Reddit ×3, AU 0), table 51 → 52       |
| Invariant violations / jsonb drift | 0                                                        |
| Auto-promotions                    | 0 (nothing clears the bar — §3b-i)                       |
| Errors                             | none                                                     |

**Mercari is the case that matters, and it is lucky timing.** It is net-new, not
denylisted, not watched, and carries NO Australian evidence — so it lands in
`globalOnly`. Under the pre-#884 logic that made `nothingAtAll` false, which
**suppressed the heartbeat**. The very first unattended run hit the exact
scenario the fix was written for: had it not shipped, the digest would have read

> No new AU-evidenced brands this week.
> _Plus 1 new global-only candidate(s)… Mercari ×3_

with no "Examined N…" line at all — no proof the run had looked at anything.

Expected digest for this run (aggregates measured ~3h later, so ±1):
`Examined 44 Reddit brand(s) … and 1 reported-scam brand(s) …; recorded 22/22`,
no degradation, plus the Mercari global-only line.

Mercari is a Japanese/US marketplace with no Australian consumer surface — a
`reviewed` candidate at most (see §6c on why not `dismissed`). It is left
**pending** deliberately: it is the first genuinely new brand this feature has
surfaced unattended, and the operator's own call on it is the thing worth
observing.

### 3b. What Monday will actually produce — measured, not guessed

**Corrected 2026-07-30 (second pass).** The original version of this section
predicted "heartbeat only" and was **wrong**, for a reason worth keeping:

The fixture the prediction rested on captured **38 of the 45 rows** the live
aggregate returns. It was not window drift — no posts had been processed since
2026-07-29 08:00 UTC — so seven rows at `mention_count = 3` were simply lost in
transcription. One of them, `googleplay` ("Google Play" ×3), was the **only**
brand in the window that is net-new, not denylisted, and not watched
(`googleplay` ≠ `google`, and no alias existed). So `globalOnly` was non-empty,
`nothingAtAll` was false, and the heartbeat — the line added in #878 precisely so
a quiet week would be legible — **would have been suppressed on its first real
run.**

Both halves are now fixed: the heartbeat is unconditional (§4.4), and v260
aliases `googleplay` to Google so the brand is correctly recognised as already
covered.

**Current prediction, verified against live prod:** every AU-evidenced brand in
the window is already watched (PayPal), denylisted as a platform (Facebook
Marketplace, YouTube), or already in the queue (eBay, Vinted, Capital One), and
`googleplay` is now aliased away. So the digest is a header plus the heartbeat
and nothing else.

Do **not** read that as failure — but do not take it on trust either. The
heartbeat now prints unconditionally, so the numbers in it are the proof.

### 3b-i. The signal is thin — this is the real limiting factor

Measured 2026-07-30, and the reason auto-promotion will fire rarely:

| Source                                | Volume over 30 days                                                       |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `reddit_post_intel`                   | 1063 posts; 657 with any country hint; **29** AU-hinted; 507 with a brand |
| …with **both** an AU hint AND a brand | **13** — the entire basis of AU evidence                                  |
| `scam_reports`                        | 15 rows; **3** carry `impersonated_brand` (20%); 2 distinct brands        |

Max `au` for any single brand is 2, and that brand (Facebook Marketplace) is
denylisted. So `meetsPromotionBar` (`au >= 2 || scam >= 2`) is currently met by
nothing promotable. This is not a bug to tune away — the bar deliberately scales
with Arthur's own traffic rather than r/Scams volume. The highest-leverage fix is
upstream: `impersonated_brand` is populated on 20% of reports (it was 11/11 in
March, 16/40 in May).

### 3c. `FF_BRAND_AUTO_PROMOTE` is untested end-to-end in prod

**Flipped ON 2026-07-30** (founder decision: make it live, then evaluate). Be
clear about what that did and did not buy:

- It did **not** test the path. On current data nothing clears
  `meetsPromotionBar` (§3b-i), so the flag promotes zero brands. Turning it on
  makes the path live for the first brand that qualifies; it exercises nothing
  today.
- It **did** make the domain-resolution path reachable at all. With the flag
  OFF, `load-trusted-domains` early-returned and `planPromotions` never ran — so
  #878's key-convention fix (140 of 307 `known_brands` rows) was dead code in
  production, and the "ready to promote — needs a confirmed domain" list was
  permanently empty.

The mechanism is proven by the replay harness (a qualifying unwatched brand
resolves `chemistwarehouse.com.au` from real `known_brands` data) and by the live
promote/demote round trip. What has still never happened is the two meeting in an
unattended run. The honest next evidence is a **human promote through
`/admin/brand-candidates`** (§5 step 5) — same RPC, human watching.

---

## 4. Bugs this verification found (all fixed)

Listed because each is a pattern worth recognising again, and because two of
three were invisible to every prior review.

1. **`known_brands.brand_key` uses a different key convention.** It is written
   by `deriveBrandKey()` (non-alphanumerics → `_`, so `australia_post`) while
   candidates are keyed by `brandNormalize()` (stripped, `australiapost`). They
   coincide **only for single-word brands**. Measured: **140 of 307**
   `known_brands` rows mismatch — 46% of the domain store, and precisely the
   multi-word AU brands (Australia Post, Commonwealth Bank, JB Hi-Fi, Chemist
   Warehouse). Auto-promotion could never resolve a domain for any of them, and
   the digest told the operator "needs a confirmed domain" for brands whose
   domain we already held. **Fixed** by deriving the key from `brand_name`
   through the same normaliser; regression test in the replay harness.

2. **The digest would have been completely silent.** The send condition was
   `if (auEvidenced || globalOnly || promoted || needsDomain)` and on real data
   all four are empty. A weekly job that goes silent when healthy is
   indistinguishable from one that has died. **Fixed**: unconditional send plus
   a heartbeat naming how many brands were examined per source, so silence is
   explicitly "healthy steady state" rather than absence.

3. **The digest could contradict itself.** `newlySurfaced` is computed before
   auto-promotion runs, so a promoted brand appeared in the same message under
   both "not yet on the clone-watch list" and "auto-promoted". **Fixed** via
   `partitionForDigest()`, extracted as a pure function precisely because the
   logic had been unreachable to tests inside a `step.run` closure.

### Second pass, 2026-07-30 — four more, all found by querying prod

4. **The heartbeat was conditional, so it would have vanished on its first real
   run.** It printed only when all four lists were empty, and prod had exactly
   one net-new global-only brand. **Fixed**: the heartbeat is now unconditional,
   and the whole message builder is extracted as `buildDigestMessage()` — same
   reasoning as `partitionForDigest` in #878, and for the same reason: this is
   where the reporting bugs live, and inside a `step.run` closure they are
   unreachable to tests. **The rule: proof of life must never be conditional on
   the absence of content.**

5. **A degraded run reported as a healthy one.** Four steps could fail, return a
   well-formed empty result, and let the run return `ok: true`. The worst case:
   an errored `aggregate_reddit_brands_with_au` produced _"Examined 0 Reddit
   brand(s)… This is the healthy steady state"_ — a dead RPC asserting health,
   which is strictly worse than the silence #878's heartbeat was added to fix.
   **Fixed**: each fallible step returns `{ rows, failed }`, the handler
   accumulates `degraded[]`, the digest leads with a warning, and the
   steady-state wording is withheld whenever anything failed.
   `load-existing-candidates` additionally now fails **closed** — it previously
   `break`ed with a partial key set, which makes every unread brand look net-new
   and re-announces the whole standing queue.

6. **Axiom could not answer "did it run, and what did it do?"** `fn.start` /
   `fn.complete` are INFO, sampled to 10% in prod, so a weekly cron was
   observable in roughly 5 runs of 52; and the per-run numbers went to
   `logger.info`, which is `console.log` with no Axiom transport, so they never
   arrived at any sample rate. The only always-ship signal was `fn.error`.
   **Fixed**: one `warn`-level `reddit-brands-discover.summary` event per run.
   See the general note now in [docs/inngest-brakes.md](../inngest-brakes.md) —
   three other low-frequency crons still have this.

7. **The same leak, mirrored — and this one had an operator about to act on
   it.** Opening `/admin/brand-candidates` after the smoke run showed **eBay at
   the top with AU evidence**, looking like the obvious promote. It is already
   monitored, as `eBay Australia`: the watchlist label normalises to
   `ebayaustralia`, the classifier only ever emits `ebay`. Where bug 7 had the
   classifier's label longer than the watchlist's, here the watchlist's is
   longer — same gate, opposite direction.

   Not one odd label: **16 of 291 entries** have an unwatched plain form
   (`Netflix (AU)`, `Spotify (AU)`, `Binance Australia`, `Foxtel / Kayo`,
   `ING Australia`, `Linkt (Transurban)`, `Opal (Transport for NSW)`,
   `Translink (Queensland)`, `myki (…)`, `Disney+ (AU)`…). **Fixed** by v261;
   `virgin` (ambiguous — Virgin Australia vs Virgin Money) and the generic stems
   (`bank`, `ip`, `services`) are deliberately left unbridged.

   Two things worth carrying forward. First, three of these keys **already had
   alias rows** — and they were self-referential (`ebay → "eBay"`), so any audit
   asking "is there an alias?" got a yes while nothing was bridged; a bridge to
   yourself is not a bridge, which is also why v261 has to be an UPSERT and not
   `ON CONFLICT DO NOTHING`. Second, the fix is deliberately NOT an `aliases`
   entry on the watchlist object: those are live **matcher tokens** and the
   field's own contract demands ≥5 chars, while five of the plain forms are
   shorter (`ebay`, `kayo`, `myki`, `opal`, `ing`) — `ing` as a matcher token
   would hit any confusable-bearing domain containing "ing". The guard is
   `packages/shopfront-glue/src/__tests__/watchlist-label-variants.test.ts`,
   which walks all 291 entries and was verified to fail when a bridge is removed.

8. **The already-watched gate leaks on classifier free-text labels.** It is exact
   set membership on `brandNormalize`, but the classifier emits free text.
   `anzbank`→ANZ and `commonwealthbank`→CBA were rescued by `brand_aliases`;
   `australiantaxofficeato` ("Australian Tax Office (ATO)") and `googleaustralia`
   were not, and both are already on the watchlist — and both clear the promotion
   bar at a 90-day window. ATO sits at 1 report in the current 30-day window, so
   it leaks the moment a second lands. **Fixed** by v260 seeding the variants
   into the existing v174 alias layer — no new matching logic, because the gate
   was not wrong, the variant was merely unknown. Same shape as bug 1: two key
   conventions that coincide only by accident.

---

## 5. The post-run checklist — RUN 2026-08-03, all green

Steps 1–4 were executed against the 2026-08-03 07:01:59 unattended run and passed
(see §3a-i). **Step 5 is the only one still outstanding**, and it is the only
check an agent cannot perform: no human has yet clicked a button on
`/admin/brand-candidates` in production. The server actions have been exercised
via their RPCs, but not through the browser path (auth → server action → RPC →
revalidate).

Keep the steps below — they are the template for any future run, not a one-off.

Run these in order. Stop at the first surprise.

**Step 1 — did it run at all?**

```sql
select max(last_seen_at) as last_write,
       count(*) filter (where au_mention_count > 0) as with_au_data,
       count(*) as rows
from public.reddit_watchlist_candidates;
```

`last_write` must be ≥ Monday 07:00 UTC. If it is still 2026-07-27, the cron did
not run — check Inngest for `reddit-brands-discover`, and confirm
`FF_REDDIT_BRANDS_DISCOVER` is still set.

**Step 2 — did the AU columns populate?**

`with_au_data` should be **> 0**. If it is 0 while `last_write` updated, the
v254 aggregate returned nothing — run
`select * from public.aggregate_reddit_brands_with_au(now() - interval '30 days', 3)`
directly and compare against the fixtures in the replay harness.

> **The RPC itself is no longer a suspect.** The v254 6-arg
> `upsert_watchlist_candidate` was exercised directly against prod on 2026-07-30
> with a synthetic key: `mention_count` 10 = 7+3, `au_mention_count` 5 = 2+3,
> per-source `source_counts` / `au_counts` jsonb correct, `resolved_canonical`
> set; test row deleted afterwards (table back to 51). If `with_au_data` is 0,
> the write path is not the reason — look at the aggregate or at whether the run
> happened at all.

**Step 3 — read the Telegram digest.** Every run now carries the heartbeat, so
read that line first. Expect one of:

- _Header + heartbeat only_ ("Examined N Reddit brand(s)… recorded N/M …
  healthy steady state") → **healthy**, and this is the predicted outcome.
- _An actionable list with AU/global splits_ → the feature is earning its keep.
  Check the split reads sensibly (an `AU 1/28` brand is a weak signal).
- _A `⚠️ DEGRADED THIS RUN` line_ → one or more steps failed and **the counts
  understate reality.** The reasons are named inline
  (`reddit_aggregate_failed`, `existing_candidates_partial`, `upserts_partial`,
  `trusted_domains_failed`, `promotions_partial`). Do not read it as a quiet
  week; the steady-state wording is deliberately withheld in this case.
- _Nothing at all_ → **regression.** The send is unconditional; silence means
  the function threw before the digest step. Check `fn.error` in Axiom.

**Step 3b — confirm the run in Axiom (new, and now the reliable check).**
Query for `reddit-brands-discover.summary`. It is emitted at `warn`, so it
bypasses the 10% INFO sample and **must** be present for every run — unlike
`fn.complete`, which you should expect to be missing ~90% of the time. It carries
every count plus `degraded` / `degradedReasons`, so this is the fastest way to
answer "did Monday's run happen, and what did it see?" without touching the DB.

```
['ask-arthur']
| where ['fields.fn'] == 'reddit-brands-discover' and message == 'reddit-brands-discover.summary'
| project _time, ['fields.candidates'], ['fields.upserted'], ['fields.upsertAttempted'],
          ['fields.newlySurfaced'], ['fields.auEvidenced'], ['fields.globalOnly'],
          ['fields.promoted'], ['fields.needsDomain'], ['fields.degraded'], ['fields.degradedReasons']
| sort by _time desc
```

> **Why this line exists, measured rather than argued.** Immediately after the
> 2026-07-30 smoke run, `/api/cron/axiom-fleet-watch` over a 20-minute window that
> **contained that successful run** reported `inngestStarts: 0`,
> `inngestStartsSampled: 0`, `infoSamplePct: 10`. The run definitely happened —
> the DB writes are timestamped 07:36:06 — yet INFO-level lifecycle events show
> nothing. That is the sampling blindness in one observation. `inngestErrors: 0`
> over the same window also confirms the run did not throw.
>
> Note `AXIOM_QUERY_TOKEN` is a **Sensitive** Vercel var: it works in prod but
> `vercel env pull` returns `""` for it, so ad-hoc APL from a laptop needs the
> token from the Axiom UI. This is the same trap as the flag-flip note in §6 —
> reading back empty does not mean unset.

**Step 4 — invariants still hold** (all must be 0):

```sql
select count(*) filter (where au_mention_count > mention_count) as violations,
       count(*) filter (where au_mention_count <>
         coalesce((select sum(v::int) from jsonb_each_text(au_counts) e(k,v)),0)) as au_sum_drift
from public.reddit_watchlist_candidates;
```

**Step 4b — read the digest text.** Not verified by the 2026-07-30 smoke run:
the message goes to the founder's admin Telegram chat, which the agent cannot
read. The run completed without error and the replay harness renders the exact
text it produces (`pnpm --filter @askarthur/web test redditBrandsDiscoverProdReplay`
prints it), but **an actual human still needs to confirm one arrived.** Expected
shape, header + heartbeat only:

```
Brands discover
No new AU-evidenced brands this week.
Examined 45 Reddit brand(s) over 30d (≥3 mentions) and 1 reported-scam brand(s) (≥2); recorded 23/23.
Nothing new: every candidate is already watched, already in the queue, or a platform name. This is the healthy steady state.
```

**Step 5 — exercise the queue once, by hand.** Open
`/admin/brand-candidates`, pick any pending row, click **Dismiss**. Confirm the
status persists and `status_changed_at` is set. This is the only part of the
write path a human has never actually clicked in prod.

---

## 6. Flag state, and what to flip next

| Flag                         | State             | Next move                                                                                                                                                                                          |
| ---------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_REDDIT_BRANDS_DISCOVER`  | ON                | —                                                                                                                                                                                                  |
| `FF_BRAND_DYNAMIC_WATCHLIST` | **ON** 2026-07-28 | —                                                                                                                                                                                                  |
| `FF_SCAM_BRANDS_SOURCE`      | **ON** 2026-07-28 | —                                                                                                                                                                                                  |
| `FF_BRAND_AUTO_PROMOTE`      | **ON** 2026-07-30 | Live, but promotes nothing on current data (§3c). The outstanding evidence is unchanged: one manual promotion through `/admin/brand-candidates`, then watch the first unattended promotion closely |

**Setting a flag — the trap that cost a deploy.** `vercel env add` defaults to
**Sensitive**, and a sensitive flag reads back empty and behaved as falsy here.
`vercel env ls` labels sensitive and non-sensitive identically as "Encrypted",
so the listing cannot tell you which you made. Always:

```bash
printf 'true' | vercel env add FF_X production --no-sensitive --force
```

Then verify with `vercel env pull --environment=production` (must show `"true"`,
not `""`), and pair the change with a commit carrying **`[build]`** — the
ignore-build-step allowlists `docs/**`, so a docs-only flag-flip commit skips
its own build and the deploy reads `CANCELED`, which looks like success.

**Never prove a flag with a route response.** `getActiveWatchlist()` fails safe,
so a dead flag and a healthy overlay return byte-identical 200s. Prove it with:

```sql
select calls, left(query,90) from extensions.pg_stat_statements
where query ilike '%list_active_monitored_brands%';
```

A real app call carries a `pgrst_source` wrapper. Only your own MCP queries
means the flag is off.

---

## 6b. NEXT PIECE OF WORK — the matcher gap v261 exposed but did not fix

Recorded separately because it is probably worth more than the queue hygiene that
found it, and because bundling it into v261 would have been wrong.

For the twelve brands v261 bridged, the **matcher** still only hunts lookalikes of
the suffixed label. It is looking for typosquats of `ebayaustralia`, `netflixau`,
`binanceaustralia`. **Nobody registers those.** Real clones are
`ebay-au-login.com`, `netflix-billing.shop`, `binance-verify.top`. So for this set
the matcher is close to inert, and has been since those entries were added.

The fix is to add the plain trading names as watchlist `aliases` (which ARE
matcher tokens). It was deliberately excluded from v261 for two reasons:

1. **It is a live behaviour change**, not a data correction. The baseline is
   30–70 hits/day (first overlay-enabled sweep 2026-07-29: 70,000 scanned / 30
   hits). Adding ~12 shorter, more generic tokens will move that, and the move
   needs measuring before it is trusted — a jump in hits is indistinguishable
   from a jump in false positives without looking.
2. **Five of the tokens are under 5 chars** (`ebay`, `kayo`, `myki`, `opal`,
   `ing`), which the `aliases` field's own contract forbids. Short tokens are
   mostly guarded — no Levenshtein below 5, substring needs an exact
   hyphen-segment match plus scam context — **but the confusable path has no
   length guard** (`lexical-match.ts`), so `ing` would match any
   confusable-bearing domain containing "ing" at score 0.9. That guard gap
   should probably be closed first, and is arguably a latent bug in its own
   right for any short alias.

Suggested shape: add a length guard to the confusable path, then add the ≥5-char
plain forms (`netflix`, `spotify`, `binance`, `foxtel`, `linkt`, `disney`,
`translink`) in one PR and measure a full sweep against the baseline before
deciding on the four-character ones.

## 6c. What `status` actually does — read this before triaging the queue

Established 2026-07-30 by measuring rather than assuming, after the founder asked
whether dismissing brands was necessary at all "if we wanted to be global one
day". The honest answer is that **dismissal is very nearly inert**:

|                                    |                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stops mention counts accruing?     | **No.** The cron never reads `status`; every run still upserts the row.                                                                                                       |
| Blocks promotion later?            | **No.** `promote_watchlist_candidate` has no status guard.                                                                                                                    |
| Stops the digest re-announcing it? | **No difference.** `newlySurfaced` excludes anything already in the table _regardless of status_, so a `pending` row re-announces exactly as often as a dismissed one: never. |
| Hides the evidence?                | Only sorts the row into the "Actioned" section of the same page.                                                                                                              |

So dismissal moves rows between two lists on one page. Nothing operational hangs
off it.

**The trap it creates is semantic, not mechanical.** `status` is being asked to
answer two different questions at once:

1. _Should the clone-watch matcher watch this brand?_ — operational.
2. _Is this brand interesting to us?_ — commercial: the queue is also a record of
   who scammers impersonate, which is the raw material for Brand Monitor.

`dismissed` reads as a verdict on (2) while only ever affecting (1). Nineteen
brands were dismissed on 2026-07-30 as "no Australian consumer surface" and then
moved to `reviewed`, because the first label wrote off a partnership signal to
tidy a matcher input. **Prefer `reviewed` ("Worth monitoring") for anything that
is merely not-for-us-today; reserve `dismissed` for genuine non-brands** — the
platform mis-tags (Reddit, Discord, Facebook Marketplace, X (Twitter)) and
already-covered duplicates like the eBay/`eBay Australia` case in §4.8.

**Going global needs none of this undone.** The Australia-specificity lives in
exactly two pure functions — `hasAuEvidence` (what the digest calls actionable)
and `meetsPromotionBar` (what may be promoted unattended). Widening coverage
means changing those two, not revisiting per-row human decisions; every brand's
mention history is retained and still accruing either way.

**Auto-promotion overrides triage, and now says so (#888).** `planPromotions`
runs over `allFresh`, which never consults `status`, so with
`FF_BRAND_AUTO_PROMOTE` ON a dismissed brand that later clears the bar IS
promoted to the live matcher. That is deliberate — two Australians reporting a
brand is new evidence, and a call made when evidence was thinner should not bind
forever — but it is no longer silent: the digest prints
`⚠️ OVERRIDES your earlier 'dismissed'` against that brand, and the Axiom summary
carries `promotionOverrides` so the question "did a cron ever reverse one of my
decisions?" is answerable by query.

## 7. Known limitations (accepted, documented, not bugs)

- **Overlay cache invalidation is per-instance.** 60s TTL, in-process. A
  promotion is live on the instance that handled the click and everywhere else
  within 60s — not instantly. If a promoted brand misses the very next sweep,
  check the sweep started <60s after the promotion before calling it a bug.
- **`idx_rwc_pending_au`** is probably never used — the admin page selects all
  rows and filters status in JS, and at 51 rows Postgres seq-scans anyway.
  Harmless; revisit if the table grows.
- **The v196 5-arg `upsert_watchlist_candidate` overload is still in the DB**,
  deliberately. Drop it only once no deployed code calls the 5-arg form.
- **`au_count` for `scam_reports` rows equals `mention_count`** by construction —
  a report to an AU consumer scam-checker is AU-native, no inference. Do not
  "fix" this to look for country hints on those rows.

---

## 8. Files that matter

| Path                                                           | Why                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/api/inngest/functions/reddit-brands-discover.ts` | The cron. Pure exports (`partitionForDigest`, `planPromotions`, `meetsPromotionBar`, `hasAuEvidence`) are the testable surface |
| `apps/web/__tests__/redditBrandsDiscoverProdReplay.test.ts`    | **The proof.** Real prod fixtures; refresh queries in its header                                                               |
| `packages/shopfront-glue/src/active-watchlist.ts`              | Pure merge + the empty-domains rejection                                                                                       |
| `packages/scam-engine/src/active-watchlist.ts`                 | The only overlay reader; cache + fail-safe behaviour                                                                           |
| `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts`        | Signature gate for untyped `.rpc()`. Needs `SUPABASE_INTEGRATION_TEST_URL` + `_SERVICE_KEY`                                    |
| `apps/web/app/admin/brand-candidates/`                         | The review queue + promote/dismiss/undo                                                                                        |
| `docs/ops/clone-watch-config.md`                               | Operator runbook, incl. the flag traps above                                                                                   |
| `supabase/migration-v254…v257*.sql`                            | Schema. All applied                                                                                                            |
