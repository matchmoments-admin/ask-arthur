# Shop Signal — Stage 0 measurement queries

> Measurement spec for the 30-day Stage 0 window that gates the Stage 1
> paid-feed go/no-go (`SHOP_GUARD_CAP_USD=15` APIVoid Adapter,
> `shop_checks` table, Inngest fan-out — issues #319 / #320 / #321).
>
> Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md) §3.
> Target shape: ≥5% URL-bearing analyzes are commerce-flagged, ≥30% of
> commerce-flagged carry ≥1 red-flag, ≥20% mobile-share share of
> commerce-flagged volume.

## Window

- **Start**: the day `FF_SHOP_SIGNAL=true` is flipped in production after
  the Stage 0 PR (#324) lands on `main` and rolls out to all users.
- **End**: 30 days later. Decision review on the 31st day.

## Data sources

Stage 0.5 lands two read-side surfaces:

1. **`scam_reports.analysis_result -> 'shopSignal'`** (JSONB). Persisted
   from `runAnalysisCore` + `/api/analyze` through `storeScamReport` (see
   `packages/scam-engine/src/report-store.ts`). One row per analysis when
   `intelligenceCore` is on. The `analysis_result` GIN index
   (`jsonb_path_ops`, v21) means the `?` operator is fast.
2. **Plausible custom events** (proposed names, not yet wired — see
   "Plausible events" below). Fired from
   `apps/web/components/ScamChecker.tsx` on submit + on result-with-shopSignal.

Stage 1 PR 3 (issue #320) replaces the JSONB read with a typed
`shop_checks` row that has direct columns for `verdict`, `composite_score`,
`source_surface`, `referrer_source`, `evaluated_at`. The queries below
will continue to work against the JSONB shape after that lands; they're
intentionally written to be source-of-truth-agnostic.

## SQL — Supabase queries

All three queries assume `intelligenceCore` is on for the measurement
window (so every analysis writes a `scam_reports` row, not just
HIGH_RISK). Verify with:

```sql
-- Should return roughly one row per /api/analyze call (modulo
-- HIGH_RISK-only writes before intelligenceCore flipped on).
select count(*) from public.scam_reports
where created_at >= now() - interval '7 days';
```

### Q1 — Commerce fraction of URL-bearing analyzes (target: ≥5%)

```sql
-- % of URL-bearing analyzes where shop-signal fired. The url-bearing
-- denominator is approximated as analyses that produced ≥1 scammer URL
-- (via report_entity_links → scam_entities). Underestimates by skipping
-- SAFE analyses with extracted URLs that didn't get linked; that's
-- conservative for "did the user submit a shop-shaped URL?" — the bias
-- only narrows acceptance.
with denom as (
  select sr.id
  from public.scam_reports sr
  where sr.created_at >= '2026-05-19'::date           -- TODO: window start
    and sr.created_at < '2026-06-18'::date            -- TODO: window end
    and exists (
      select 1
      from public.report_entity_links rel
      join public.scam_entities se on se.id = rel.entity_id
      where rel.report_id = sr.id
        and se.entity_type in ('url', 'domain')
    )
),
flagged as (
  select sr.id
  from public.scam_reports sr
  where sr.created_at >= '2026-05-19'::date
    and sr.created_at < '2026-06-18'::date
    and sr.analysis_result ? 'shopSignal'
    and (sr.analysis_result -> 'shopSignal' ->> 'isCommerce')::boolean = true
)
select
  (select count(*) from flagged)::numeric * 100
    / nullif((select count(*) from denom), 0) as commerce_pct,
  (select count(*) from flagged) as commerce_count,
  (select count(*) from denom)   as url_bearing_count;
```

**Pass:** `commerce_pct >= 5`.

### Q2 — Flag-extraction rate among commerce-flagged (target: ≥30%)

```sql
-- Of the analyses where shop-signal fired, what % returned ≥1
-- commerce-specific tag in commerceFlags[]? The 11-tag taxonomy is in
-- packages/scam-engine/src/shop-signal.ts (COMMERCE_FLAG_TAXONOMY).
-- A miss here means commerce was detected but no specific red-flag
-- matched — useful as the Stage 0.5-vs-1 tripwire: <30% justifies the
-- commerce-specific prompt addendum (deferred per Stage 0 footnote).
with commerce_rows as (
  select sr.id, sr.analysis_result -> 'shopSignal' as ss
  from public.scam_reports sr
  where sr.created_at >= '2026-05-19'::date
    and sr.created_at < '2026-06-18'::date
    and sr.analysis_result ? 'shopSignal'
    and (sr.analysis_result -> 'shopSignal' ->> 'isCommerce')::boolean = true
),
with_flags as (
  select id
  from commerce_rows
  where jsonb_array_length(coalesce(ss -> 'commerceFlags', '[]'::jsonb)) > 0
)
select
  (select count(*) from with_flags)::numeric * 100
    / nullif((select count(*) from commerce_rows), 0) as flag_extraction_pct,
  (select count(*) from with_flags)     as with_flag_count,
  (select count(*) from commerce_rows)  as commerce_count;
```

**Pass:** `flag_extraction_pct >= 30`.

### Q3 — Mobile-share share of commerce-flagged volume (target: ≥20%)

```sql
-- Of the analyses where shop-signal fired, what % carried a
-- referrerSource (Web Share Target → /share-target → analyze pipeline)?
-- Stage 0.5 records four in-app sources: instagram-inapp,
-- tiktok-inapp, facebook-inapp, whatsapp-inapp. Anything else (direct
-- URL bar, search engine, RSS reader, etc.) yields no referrerSource —
-- those are the "non-mobile-share" rows in the denominator.
with commerce_rows as (
  select sr.id, sr.analysis_result -> 'shopSignal' as ss
  from public.scam_reports sr
  where sr.created_at >= '2026-05-19'::date
    and sr.created_at < '2026-06-18'::date
    and sr.analysis_result ? 'shopSignal'
    and (sr.analysis_result -> 'shopSignal' ->> 'isCommerce')::boolean = true
)
select
  ss ->> 'referrerSource' as referrer_source,
  count(*) as row_count,
  count(*)::numeric * 100 / sum(count(*)) over () as pct
from commerce_rows
group by ss ->> 'referrerSource'
order by row_count desc;
```

**Pass:** the row with `referrer_source IN ('instagram-inapp',
'tiktok-inapp', 'facebook-inapp', 'whatsapp-inapp')` aggregated sums
to ≥20% of total.

### Bonus — Taxonomy distribution (qualitative, not a gate)

```sql
-- Which commerce-flag tags are firing most? Informs Stage 1 prompt /
-- taxonomy refinement. No pass/fail; surface in the retro.
select
  tag,
  count(*) as hits
from public.scam_reports sr,
     jsonb_array_elements_text(
       sr.analysis_result -> 'shopSignal' -> 'commerceFlags'
     ) as tag
where sr.created_at >= '2026-05-19'::date
  and sr.created_at < '2026-06-18'::date
  and sr.analysis_result ? 'shopSignal'
group by tag
order by hits desc;
```

## Plausible events

The web app loads `next-plausible` (CSP allows `plausible.io` and the
domain script attribute is already on `<html>` via the layout). Stage 0.5
defines the event names but the calls themselves land in a small
follow-up PR — wiring them now would also add a `usePlausible` hook to
`ScamChecker.tsx` and require touching the result-render lifecycle, both
of which felt like avoidable surface area for a "wire the referrer" PR.

```ts
// On /api/analyze submit:
plausible("scam_check_submitted", {
  props: {
    has_text: !!text.trim(),
    has_images: images.length > 0,
    referrer_source: referrerSource ?? "direct",
  },
});

// When the response includes shopSignal (result-render lifecycle hook):
plausible("shop_signal_emitted", {
  props: {
    verdict: result.verdict,
    flag_count: result.shopSignal.commerceFlags.length,
    referrer_source: result.shopSignal.referrerSource ?? "direct",
  },
});
```

Plausible custom-event filtering is available on the existing dashboard
at `plausible.io/askarthur.au`. Compose the same three gates from
Plausible's "Goal Conversions" view as a sanity check against the SQL.

## Decision tree on day 31

| Q1  | Q2   | Q3   | Action                                                                                                                                                       |
| --- | ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≥5% | ≥30% | ≥20% | Proceed to Stage 1. Flip issues #319 / #320 / #321 to `ready-for-agent`.                                                                                     |
| <5% | —    | —    | Demand is too low. Write Stage-0-was-the-ceiling retro. Close #319-#323.                                                                                     |
| ≥5% | <30% | —    | Demand exists; taxonomy too thin. Re-evaluate the commerce-specific prompt addendum (deferred per Stage 0 footnote) BEFORE Stage 1 APIVoid spend.            |
| ≥5% | ≥30% | <20% | Mobile-share isn't the dominant entry. De-prioritise the share-sheet UX work but proceed to Stage 1 — the URL-bearing organic-search path is still in scope. |

## Related

- Plan: [`docs/plans/shop-guard-v2.md`](../plans/shop-guard-v2.md)
- Stage 0 commit (this measurement reads from): `ac94ef9` (PR #324)
- Stage 0.5 PR / issue: #318 (this branch — `shop-signal/stage-0.5`)
- Stage 1 PR 2 (APIVoid): #319
- Stage 1 PR 3 (`shop_checks` migration — supersedes JSONB queries): #320
- Stage 1 PR 4 (Inngest + accordion + Stage-2 gate): #321
