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
through the real exported functions in the order the cron calls them. 19
assertions. Refresh instructions are in its header.

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

The replay harness says: **nothing new.** Every AU-evidenced brand in the
current window is already watched (PayPal), denylisted as a platform (Facebook
Marketplace, YouTube), or already in the queue (eBay, Vinted, Capital One).

So do **not** read a quiet digest as failure. Read the heartbeat line instead
(added for exactly this reason — see §4).

### 3c. `FF_BRAND_AUTO_PROMOTE` is untested end-to-end in prod

It is OFF. On current data it would promote **zero** brands, so turning it on
proves nothing. The mechanism is proven by the replay harness (a qualifying
unwatched brand resolves `chemistwarehouse.com.au` from real `known_brands`
data) and by the live promote/demote round trip — but the two have never met in
an unattended run.

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

**Step 3 — read the Telegram digest.** Expect one of:

- _Heartbeat only_ ("Examined N Reddit brand(s)… nothing new") → **healthy**, per
  §3b. This is the predicted outcome.
- _An actionable list with AU/global splits_ → the feature is earning its keep.
  Check the split reads sensibly (a `AU 1/28` brand is a weak signal).
- _Nothing at all_ → **regression.** The send is now unconditional; silence
  means the function threw before the digest step.

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

| Flag                         | State             | Next move                                                                                                                                                                                    |
| ---------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FF_REDDIT_BRANDS_DISCOVER`  | ON                | —                                                                                                                                                                                            |
| `FF_BRAND_DYNAMIC_WATCHLIST` | **ON** 2026-07-28 | —                                                                                                                                                                                            |
| `FF_SCAM_BRANDS_SOURCE`      | **ON** 2026-07-28 | —                                                                                                                                                                                            |
| `FF_BRAND_AUTO_PROMOTE`      | **OFF**           | Flip on evidence, not a date: **two** digests proposing a brand you would have promoted yourself, **plus** one manual promotion through `/admin/brand-candidates` (same RPC, human watching) |

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
