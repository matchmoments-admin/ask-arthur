# Handoff — clone-watch brand-discovery: verification state

**Written 2026-07-30.** Owner of the next session: read this top to bottom before
touching anything. It exists because the honest answer to "does it work?" is
_mostly yes, and here is precisely which parts are proven, which are not, and
how to finish proving them._

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

### 3a. The cron has never run with this code (the big one)

`reddit-brands-discover` is weekly, Monday 07:00 UTC. It last wrote on
**2026-07-27 07:01**, hours _before_ v254 deployed. So:

- `au_mention_count` is **0 on all 51 candidates**
- the admin queue ranks everything at AU 0
- `FF_SCAM_BRANDS_SOURCE` has never contributed a row

**Next run: Monday 2026-08-03 07:00 UTC.** The founder chose the scheduled run
over firing the manual trigger, deliberately — the unattended path is the
honest test.

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

7. **The already-watched gate leaks on classifier free-text labels.** It is exact
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

## 5. Monday 2026-08-03 — the checklist

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

**Step 4 — invariants still hold** (all must be 0):

```sql
select count(*) filter (where au_mention_count > mention_count) as violations,
       count(*) filter (where au_mention_count <>
         coalesce((select sum(v::int) from jsonb_each_text(au_counts) e(k,v)),0)) as au_sum_drift
from public.reddit_watchlist_candidates;
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
