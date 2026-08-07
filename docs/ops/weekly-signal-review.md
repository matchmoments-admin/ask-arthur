# Weekly signal review — Monday runbook

_~10 minutes, founder or agent. Issue [#934](https://github.com/matchmoments-admin/ask-arthur/issues/934); signals named per surface in [NORTH_STAR.md](../../NORTH_STAR.md) ("a feature isn't done when merged; it's done when someone used it and we saw the signal")._

Run every Monday, after the 08:00 UTC canary has fired (≈ 6pm AEST; running earlier in the AU morning reads _last_ week's canary — fine, just note it). Record the numbers in the log at the bottom **every week, including zero weeks**.

All SQL runs against prod (service role — SQL editor or `mcp__supabase__execute_sql`).

---

## 1. Canary — is the alerting fabric alive?

Did the Monday Telegram heartbeat arrive? Then confirm what it said:

```sql
SELECT fired_at, condition_met, outcome, metadata->'silent' AS silent_alerters
FROM alert_delivery_log
WHERE alerter = 'alerting-canary'
ORDER BY fired_at DESC
LIMIT 1;
```

- **No heartbeat in Telegram** = the channel itself may be dead — check the [`/api/cron/alerting-canary`](../system-map/background-workers.md) run before trusting any other "quiet" alerter this week.
- **`silent_alerters` non-empty** = those alerters wrote no `alert_delivery_log` rows above their liveness floor — investigate each before assuming "no news is good news". (A heartbeat gated on "nothing to report" vanishes exactly when there's noise — that's why the canary is unconditional, #884.)

## 2. Surface signals — week over week

One query per live door. Compare against last week's row in the log.

**Forwarded scans (scan@askarthur.au):**

```sql
SELECT count(*) FROM cost_telemetry
WHERE feature = 'inbound_scan' AND created_at > now() - interval '7 days';
```

**Charity checks:**

```sql
SELECT feature, count(*) FROM cost_telemetry
WHERE feature LIKE 'charity%' AND created_at > now() - interval '7 days'
GROUP BY 1;
```

plus the overall verdict mix (uncertain share rising = the checker is being asked things it can't answer):

```sql
SELECT sum(total_checks) AS checks, sum(uncertain_count) AS uncertain,
       sum(safe_count) AS safe, sum(suspicious_count) AS sus, sum(high_risk_count) AS high
FROM check_stats WHERE date > current_date - 7;
```

**Clone-watch + theme-page organics:** Plausible (askarthur.au dashboard) — visitors to `/clone-watch*` and `/intel/themes/*`; for blog posts, first-party views:

```sql
SELECT path, count(*) AS views FROM analytics_events
WHERE event_type = 'pageview' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

**Newsletter subscribers (total + which surface captured them):**

```sql
SELECT count(*) FILTER (WHERE is_active) AS active, consent_source, count(*)
FROM email_subscribers GROUP BY consent_source;
```

**Cache-served vs fresh analyses** (cache share rising = repeat scams circulating; also the cost denominator):

```sql
SELECT analysis_result->>'cacheHit' AS cache_hit, count(*)
FROM scam_reports WHERE created_at > now() - interval '7 days'
GROUP BY 1;
```

## 3. Spend — 7-day cost by feature

```sql
SELECT feature, round(sum(estimated_cost_usd)::numeric, 4) AS usd, sum(units) AS units
FROM cost_telemetry
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

Anything unfamiliar in the top rows, or a feature whose spend moved sharply without a matching usage move in §2, gets a look at `/admin/costs` before the week starts. (Free-tier features log `units` at `estimated_cost_usd = 0` deliberately — volume visibility, not an error.)

## 4. The recording rule

**Write the numbers down every week** — append a row to the log below (or the founder's equivalent sheet), including weeks where everything is zero. The point of the rhythm:

- A number only means something against last week's number.
- **Zero movement for 6 consecutive weeks on any surface is a recordable answer, not silence** — it triggers a decision (change the distribution play, or mothball per the NORTH_STAR.md process), never another quiet week.

| Week (Mon) | Scans fwd | Charity checks | Blog views | Subscribers (active) | Cache-hit % | 7-day spend | Notes |
| ---------- | --------- | -------------- | ---------- | -------------------- | ----------- | ----------- | ----- |
| _template_ |           |                |            |                      |             |             |       |

## 5. Pointers

- **What each surface's success signal is:** [NORTH_STAR.md](../../NORTH_STAR.md) + the per-item signals in [#933](https://github.com/matchmoments-admin/ask-arthur/issues/933).
- **Background-function brakes / kill-switches:** [docs/inngest-brakes.md](../inngest-brakes.md) — a blank cell there is a P1.
- **What we're deliberately waiting on (don't re-litigate):** the annotated waits list in [#903](https://github.com/matchmoments-admin/ask-arthur/issues/903) and BACKLOG's annotated schedule.
