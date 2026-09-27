# Clone Watch — handoff (2026-09-27)

Map #1224 ("Clone Watch best version") after the 2026-09-26/27 execution run.
Read this first. The previous handoff was
[clone-watch-handoff-2026-09-24.md](./clone-watch-handoff-2026-09-24.md).

## TL;DR

- The engineering in map #1224 is done. Every ticket is closed or has a
  reviewed PR, and everything merged has been verified on real prod runs.
- **Three things are waiting on a date:**
  1. **1 Oct 01:00 / 11:00 UTC:** first real run of the monthly store v2
     (stock snapshot, then summary and the September readiness scorecard).
  2. **1 Oct after 12:00 UTC:** merge #1262 (matcher v5). Its migration v337
     is already applied.
  3. **1 Oct 00:00 UTC onward:** 141 WHOIS rows are re-offered, first by the
     13:30 enricher run.
- **Brand contact stays blocked:** the readiness scorecard gates every real
  send. Nothing can pass before the 1 Dec scorecard, and only if October and
  November both read ready (see "Founder items").

## What shipped (all merged, migrations applied, verified in prod)

| Ticket                              | PR(s)              | Migration  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1225 monthly store v2              | #1244              | v325       | Stock (lookalikes still up at month end, from a DNS-only snapshot) plus new-this-month per brand; zero rows for watched brands; provenance (matcher, classifier mix, swept domains, coverage). NULL means not measured. Snapshot trusted only with a completion record (`clone_liveness_runs`).                                                                                                                                                                 |
| #1226 honest MoM                    | #1247, #1255       | —          | Prior month read from the FROZEN store. Under 2σ reads "about the same". A matcher or coverage change suppresses the delta. Feed-volume caveat. Three-month line. One copy home: `trend-copy.ts`.                                                                                                                                                                                                                                                             |
| #1228 NRD step output               | #1241, #1245       | —          | Ingest is one step returning hits only; the free feed is capped at 70k/day.                                                                                                                                                                                                                                                                                                                                                                                   |
| #1231 caps                          | #1246              | v328       | Caps sized to urlscan's real limits (unlisted 60/min, 100/h, 1,000/day). `cap`/`cap_reached` on the Outcome Row. `cap_bound` health rule (after silent_zero). Recheck `due_total`.                                                                                                                                                                                                                                                                             |
| #1232 wasted lookups                | #1240              | v326       | RDAP misses are final; whoisjson monthly guard; dead-dormancy; 45-day taper.                                                                                                                                                                                                                                                                                                                                                                                   |
| #1234 takedown metrics              | #1254              | v329       | One clock per duration. Public tile: detect→blocklist, "n=7 of 44 weaponised". DNS sweep moves offline sites weaponised→dormant (two NXDOMAIN reads ≥12h apart), with re-emergence. Vendor-gap escalation page. #1148 processing skip. Resubmit no longer re-files "Already reported and rejected." Also restored the v289/v290 files to main; they had been live in prod since 2026-08-24.                                                                    |
| #1235 worklist hygiene              | #1239              | v327       | Autovacuum tuning; unused index dropped.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| #1238 not-a-clone audit             | #1249, #1258       | v330       | A measurement-only sample of classifier-rejected alerts, riding the 09:00 submit lane (≤25/day). A miss never weaponises and is withheld from brand counts.                                                                                                                                                                                                                                                                                                   |
| #1229 minimum invocations           | #1252, #1261       | v331, v334 | Enricher fold (~63→5 steps/day). Batched recheck stamp. **Recheck DNS Gate:** a free DNS fingerprint (/24, /48, NS) decides who gets a urlscan rescan. Shared anycast fronts (Cloudflare, Vercel, GoDaddy) are opaque and get a 7-day floor; leftover slots go to the stalest rows. Pull-step and in-producer retrieve were ruled out on measured value.                                                                                                        |
| #1230 idle lanes                    | #1248, #1251, #1257 | —         | `parked` marker in LANE_SHAPES. auto-triage retired; its auto-park now runs inside each pre-classifier batch (backfill parked 50).                                                                                                                                                                                                                                                                                                                             |
| #1162 decorative timeouts           | #1250              | v332       | Six RPCs get a real function-level `statement_timeout`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| #1253 WHOIS deferral                | #1259              | v336       | A quota-skipped or failed WHOIS retries on the 1st (quota) or in 24h (HTTP) instead of being saved as final. A 429 is never a strike. 141 rows are due 1 Oct.                                                                                                                                                                                                                                                                                                 |
| #1256 audit-miss leak               | #1258              | —          | Audit samples are withheld from brand-attributed counts in the cohort query. An operator confirmation or `is_clone=true` releases them.                                                                                                                                                                                                                                                                                                                       |
| #1237 readiness scorecard           | #1260              | v335       | Seven measured components, founder-approved thresholds (`lib/clone-watch/readiness.ts`). Every real brand send fails closed until 2 consecutive ready months. Human verdicts are tracked by `triage_source`.                                                                                                                                                                                                                                                  |
| #1263 tp_actioned origin            | #1264              | v338       | The auto lane stamps `triage_source='machine'` when it changes a status (except tp_confirmed→tp_actioned).                                                                                                                                                                                                                                                                                                                                                    |
| Security / platform (earlier round) | #1201–#1243        | v321–v324  | See the local security map (not in git).                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Pending — do these on 1 Oct

A session-scoped scheduler was set up for this. **Do not rely on it**: it dies
with the Claude session. Run it by hand:

1. **After 01:00 UTC:** check the September stock snapshot.
   `SELECT * FROM clone_liveness_runs WHERE period_month='2026-09-01'` should
   return a row whose `written` equals the snapshot row count, with
   unverified ≤ 20%.
2. **After 11:00 UTC:** check the September summary.
   - `clone_watch_monthly_brand_stats` has 2026-09-01 rows that are frozen,
     have `matcher_version='v4'`, have `active_stock_eom` set for most brands,
     and include zero rows.
   - The summary Outcome Row says `store_status=written`.
   - `clone_watch_readiness` has a row for 2026-09-01, expected `ready=false`.
3. **After 12:00 UTC:** merge **#1262** (matcher v5).
   - Rebase it, wait for green CI, merge, then run
     `curl -X PUT https://askarthur.au/api/inngest` and check it returns
     `modified:true`.
   - v337 is already applied.
   - If the merge slips past October, move `MATCHER_V5_FROM` to the merge
     month in the same PR.
4. **Not-a-clone baseline draw** (a prod write, approved for #1238):
   `SELECT public.draw_clone_not_a_clone_audit_sample('baseline','2026-09',100);`
   Read the result about 5–6 days later with
   `SELECT * FROM clone_watch_not_a_clone_audit_summary()`.
5. **13:30 UTC:** check the enricher Outcome Row. It should show
   `whois_reoffered > 0`, at most 20 per run, working through the 141 rows.

## Watch items (first week)

- **Recheck DNS Gate.** Bootstrap run (27 Sep 00:33 UTC): 600 DNS reads in
  25s, 549 with no baseline, 154 opaque, 0 rate-limited. Expect
  `dns_unchanged` to climb and `stale_fill` to become non-zero after about 5–6
  days. If `dns_opaque` is near 0, the ranges aren't matching. Raise
  `RECHECK_DNS.limit` once `dns_ms` is known (demand is about 3,800/day
  against 2,400 DNS reads/day).
- **Liveness sweep.** 53 weaponised sites read NXDOMAIN once. They are
  confirmed offline and moved to dormant on the next 10:00 UTC reconcile.
  Expect the weaponised count to drop.
- **Auto-park** now runs in the pre-classifier. The `batch` row should carry
  `auto_parked` and `auto_park_failed=false`.
- **Health digest** was clean on 26 Sep 22:00 (no lane problems).
- **`.shop` RDAP `not_found` rate:** the enricher pace went up in #1252.

## Open tickets (child of #1224)

- **#1265 (NEW, real regression):** Netcraft batches have re-fattened to
  about 5 URLs per submission uuid, and 12 weaponised clones are stranded by
  uuid collision. Likely cause: the resubmit lane files up to 15 URLs under one
  uuid. Watch queries are in `docs/ops/clone-watch-config.md` → "Escalation is
  gated by BATCH SIZE".
- **#1150 → PR #1262:** matcher v5, merge after 1 Oct 12:00 UTC.
  - Recall 237/238. woles.net is a documented miss (Coles was excluded for
    precision).
  - Same-label multi-TLD bursts count once in the rankings.

## Founder items

1. **Human triage.** None since 6 June. Precision and FP share need about 10
   decided verdicts a month or they read "insufficient", so no month can be
   ready. Either resume sampled triage or revisit the minimums in
   `readiness.ts`.
2. **Onward brand-abuse reports (`onward-brand-abuse`).** Does the #1227
   no-contact rule cover them? They are currently ungated, and 0 have ever been
   sent.
3. **Founder outreach route (`/api/admin/brand-outreach/send`).** Ungated by
   design. Confirm that is intended.
4. **Carried:** email worker deploy (#1219), legal sign-off (#371).

## Traps learned this run (detail in the memory notes)

- **A duplicate `{ event }` in one createFunction fails the WHOLE Inngest
  sync.** Guarded by `inngestDuplicateTriggers.test.ts`. Always read the
  `PUT /api/inngest` body.
- **Prettier re-wraps markdown tables**, so every doc-touching rebase
  conflicts. Take main's file and re-apply the commit's own rows. Never
  line-merge.
- **Pin exact worktree paths** and assert the branch before any rebase or
  force-push. A `grep` on `git worktree list` matched another session's
  worktree.
- **Re-created SQL functions must come from the LIVE body**
  (`pg_get_functiondef`), not the last file on main. v289/v290 were live but
  not on main, and v329 nearly reverted v289.
- **About half of weaponised clones sit on Cloudflare.** Any DNS/IP-based
  change detection must treat shared fronts as opaque.
- **An exact DNS fingerprint false-flags about 4% in 11 minutes** (anycast and
  parking rotation). Compare by prefix.
- **GitHub CI sometimes hangs for 8 minutes with no turbo output.** Rerun it; a
  normal run takes about 3 minutes.
