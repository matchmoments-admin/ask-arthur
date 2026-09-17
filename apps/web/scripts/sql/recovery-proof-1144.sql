-- Recovery proof for #1142 (map #1143, ticket #1144).
-- Run each block on its own with:
--   pnpm --filter @askarthur/web tsx scripts/_query.ts --sql "<block>"
-- (the Management API runner takes one statement; do not paste the file whole).
-- The REST sweep for cancelled runs (block 5) is not SQL — see the bottom.

-- ── 1a. recheck lane per run: rechecked must be ≈50 with a MIXED submitted /
--        submit_failed split (Sep 9–16 was 0 / 50 every run).
select created_at, units,
       metadata->>'pool' as pool, metadata->>'rechecked' as rechecked,
       metadata->>'submitted' as submitted, metadata->>'submit_failed' as submit_failed,
       metadata->>'declined' as declined, metadata->>'monitoring' as monitoring
  from cost_telemetry
 where feature = 'shopfront_clone_recheck' and operation = 'recheck_batch'
   and created_at > '2026-09-16 20:00+00'
 order by created_at desc;

-- ── 1b. the 50 DNS-dead domains: fresh stamp, and ABSENT from the worklist
--        for 168h. Call the RPC; never read its WHERE clause.
select count(*) as dead_400,
       count(*) filter (where last_rechecked_at > '2026-09-16 20:00+00') as restamped_since_fix,
       min(last_rechecked_at) as oldest_stamp
  from shopfront_clone_alerts
 where urlscan_evidence->>'status' = '400'
   and lifecycle_state in ('declined','monitoring');

select count(*) as dead_400_in_worklist
  from list_clone_alerts_for_recheck(200, 6, 168) w
  join shopfront_clone_alerts a on a.id = w.id
 where a.urlscan_evidence->>'status' = '400';

-- ── 2. submit lane per day: submitted > 0 (was 0 since Sep 12). Note the
--       row's created_at — if the 09:00 run's row lands 09:03+, the :00 pileup
--       is real and the cron should move (#1069 moved others).
select created_at, units,
       metadata->>'submitted' as submitted, metadata->>'submit_failed' as submit_failed,
       metadata->>'rate_limited' as rate_limited, metadata->>'reputation_hits' as reputation_hits,
       metadata->>'dormant_retired' as dormant_retired
  from cost_telemetry
 where feature = 'shopfront_clone_urlscan' and operation = 'submit_batch'
   and created_at > '2026-09-10'
 order by created_at desc;

-- ── 3a. the §4a series: weaponised_at by week (the honest number).
select date_trunc('week', weaponised_at)::date as wk, count(*) as weaponised,
       count(*) filter (where coalesce(recheck_count,0) > 0) as via_recheck,
       count(*) filter (where coalesce(recheck_count,0) = 0) as via_initial
  from shopfront_clone_alerts
 where weaponised_at > now() - interval '56 days'
 group by 1 order by 1 desc;

-- ── 3b. likely_phishing by scan week + unconverted (must stay 0–2).
select date_trunc('week', urlscan_scanned_at)::date as wk,
       count(*) filter (where urlscan_classification = 'likely_phishing') as likely_phishing,
       count(*) filter (where urlscan_classification = 'likely_phishing'
                          and weaponised_at is null) as unconverted
  from shopfront_clone_alerts
 where urlscan_scanned_at > now() - interval '35 days'
 group by 1 order by 1 desc;

-- ── 3c. daily since the fix.
select weaponised_at::date as d, count(*) as weaponised,
       count(*) filter (where coalesce(recheck_count,0) > 0) as via_recheck
  from shopfront_clone_alerts
 where weaponised_at > '2026-09-10'
 group by 1 order by 1 desc;

-- ── 4. #1067 detection window (first_seen → weaponised) on rows that
--       weaponised in the window; median / p90 in days.
select count(*) as n,
       round((percentile_cont(0.5) within group (order by extract(epoch from weaponised_at - first_seen_at)) / 86400)::numeric, 2) as median_days,
       round((percentile_cont(0.9) within group (order by extract(epoch from weaponised_at - first_seen_at)) / 86400)::numeric, 2) as p90_days
  from shopfront_clone_alerts
 where weaponised_at > '2026-09-16 20:00+00' and first_seen_at <= weaponised_at;

-- ── 5. Cancelled runs (the #1069 class) for the clone-watch fns — REST, not SQL:
--   scratchpad/inngest-runs.sh "shopfront-clone" <received_after> <received_before>
--   i.e. GET api.inngest.com/v1/events?name=inngest/function.cancelled&received_after=…
--   (~51-row cap → split windows of ≤6h). Expect: none.
