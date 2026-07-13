# Reddit Intel — historical theme rebuild (operator runbook)

**Status:** ready to execute. **Not yet run.** This is a destructive, long-running
data operation → run it in a **maintenance window with an operator watching**,
per the root `CLAUDE.md` ship-workflow rule for destructive migrations. Do **not**
auto-apply any step here via the MCP.

## Why this exists

The 2026-07-12 Inngest fleet review found `reddit-intel-cluster` had collapsed
into **one runaway mega-theme**: greedy assignment + an unbounded online-mean
centroid degenerated so a single theme absorbed **2263 of 2543 posts (89%)** and
no new themes formed for ~70 days, while the Sonnet naming call silently stopped
firing (144/160 themes still `title = 'Pending naming'`).

**PR #717 stopped the bleeding** with two structural guards that are now live in
`reddit-intel-cluster.ts`:

- `CENTROID_FREEZE_AT = 50` — a theme's centroid stops updating past 50 members,
  so it can't drift toward the global mean (kills attractor _formation_).
- `MAX_THEME_MEMBERS_FOR_JOIN = 250` — a theme this large is no longer a valid
  match target; a post that would have joined it re-seeds instead (_contains_ the
  already-drifted 2263-member blob).

Those guards prevent **recurrence** but do not **repair history**: the 2263 posts
stay mislabeled in the one theme. This runbook re-clusters them under the guards.

## Ground truth (captured 2026-07-13 — RE-RUN §1 live before executing)

| Fact                            | Value                                  |
| ------------------------------- | -------------------------------------- |
| Total posts (all embedded)      | 2543                                   |
| Runaway theme id                | `a94bbd04-5b14-46c4-a3a7-9e3562f10177` |
| Runaway theme members           | 2263 (89% of corpus)                   |
| Total themes / `is_active`      | 160 / 160                              |
| Themes `title='Pending naming'` | 144 (90%)                              |
| Distinct cohort days            | 58 (2026-05-01 → 2026-07-12)           |
| Embedding models present        | voyage-3, voyage-3.5                   |

**Never trust these numbers at execution time** — the corpus grows daily. Step 1
re-captures them live; every later step reads from the live DB.

## Foreign-key behaviour (why the reset is one statement)

Verified against prod:

- `reddit_post_intel.theme_id → reddit_intel_themes` is **ON DELETE SET NULL**.
- `reddit_post_intel_themes.theme_id → reddit_intel_themes` is **ON DELETE CASCADE**.
- `reddit_post_intel_themes.intel_id → reddit_post_intel` is **ON DELETE CASCADE**.

So **deleting a theme row automatically nulls every post's `theme_id` and deletes
its junction rows.** The reset is a single `DELETE FROM reddit_intel_themes …`;
no manual cleanup of the child tables is needed. `reddit_intel_themes` is not a
hot write-frequent table (160 rows), so no chunking is required.

---

## Procedure

### Scope decision — FULL vs TARGETED

- **FULL rebuild (recommended).** Delete all 160 themes; re-cluster all 2543 posts
  from scratch under the guards. Produces the cleanest, most coherent theme set
  (the whole corpus was clustered under the broken regime, including the 16 named
  themes). Cost: re-names most themes via Sonnet across the replay (est. a few
  A$, may brush the `REDDIT_INTEL_CAP_USD = 10/day` cap — see §5).
- **TARGETED rebuild (lower blast radius).** Delete only the runaway theme; its
  2263 posts re-cluster against the surviving 159 themes + new seeds. Smaller
  change, but those survivors are mostly 1–2-member noise, so the result is less
  coherent. Use only if a full re-name is undesirable this window.

The steps below are written for **FULL**; the TARGETED deltas are called out inline.

### 1. Pre-flight snapshot (READ-ONLY — safe to run any time)

Re-capture ground truth and confirm the runaway is still the top theme:

```sql
select 'total_posts' k, count(*)::text v from reddit_post_intel
union all select 'posts_with_theme', count(*)::text from reddit_post_intel where theme_id is not null
union all select 'total_themes', count(*)::text from reddit_intel_themes
union all select 'max_member_count', max(member_count)::text from reddit_intel_themes
union all select 'top_theme_id', (select theme_id::text from reddit_post_intel
   where theme_id is not null group by theme_id order by count(*) desc limit 1)
union all select 'pending_naming', count(*)::text from reddit_intel_themes where title='Pending naming'
union all select 'distinct_cohorts', count(distinct processed_at::date)::text from reddit_post_intel;
```

### 2. Backup for rollback (run INSIDE the maintenance window, just before the reset)

```sql
-- Timestamped backups. Keep until the rebuild is verified good, then drop.
create table reddit_intel_themes_backup_20260713 as
  select * from reddit_intel_themes;
create table reddit_post_intel_themes_backup_20260713 as
  select * from reddit_post_intel_themes;
create table reddit_post_intel_theme_map_backup_20260713 as
  select id, theme_id from reddit_post_intel where theme_id is not null;
```

Confirm row counts match §1 (`themes` = 160, `map` = posts_with_theme).

### 3. Reset

**FULL:**

```sql
delete from reddit_intel_themes;   -- cascades: junction deleted, post.theme_id → NULL
```

**TARGETED (alternative):**

```sql
delete from reddit_intel_themes where id = 'a94bbd04-5b14-46c4-a3a7-9e3562f10177';
```

Verify: `select count(*) from reddit_intel_themes;` → 0 (FULL) / 159 (TARGETED),
and `select count(*) from reddit_post_intel where theme_id is not null;` → 0
(FULL) / (total − 2263) (TARGETED).

### 4. Replay cohorts through the guarded clusterer — **SERIAL, oldest-first**

Re-clustering is done by re-firing the `reddit.intel.embedded.v1` event once per
cohort day. The **live** `reddit-intel-cluster` fn (with the guards + the
`concurrency: { limit: 1 }` ceiling added alongside this runbook) then loads that
cohort's now-unassigned posts and clusters them.

**Ordering matters and must be serial.** Greedy assignment is stateful and
order-dependent — earlier cohorts must seed themes before later cohorts match
against them. The `concurrency: { limit: 1 }` ceiling makes overlapping runs
_serialize_ rather than race, but you still want them to run **oldest cohort
first**. Two ways:

**4a. Inngest dashboard (manual, fully controlled).** Get the ordered cohort list:

```sql
select processed_at::date as cohort_date, count(*) as posts
from reddit_post_intel
where theme_id is null            -- only cohorts with work to do
group by 1 order by 1 asc;        -- OLDEST FIRST
```

For each row, in order, send an event (Inngest dashboard → Send Event):

```json
{
  "name": "reddit.intel.embedded.v1",
  "data": {
    "cohortDate": "2026-05-01",
    "postsEmbedded": 12,
    "embeddingProvider": "voyage",
    "modelId": "voyage-3.5"
  }
}
```

Only `cohortDate` drives the clusterer (it re-queries posts by
`processed_at`within that day where `theme_id IS NULL`); the other three fields
just satisfy the event's Zod schema. **Wait for each run to reach "Completed" in
the Inngest run log before sending the next** — the `concurrency: 1` ceiling
enforces this even if you don't, but watching each run lets you catch a
`single-attractor collapse signature` warn early (see §6).

**4b. Scripted (faster, still serial).** If running the ~58 sends by hand is too
slow, drive them from a one-off Node script that `await`s each `inngest.send()`
**and** polls the run to completion before the next — or simply relies on the
`concurrency: 1` ceiling and sends them oldest-first with a fixed delay. Do **not**
bulk-send all events with no ordering: even with `concurrency: 1` the _queue
order_ would be arbitrary, breaking the oldest-first seeding.

### 5. Naming + cost

Naming fires **inline** in the clusterer: after each cohort's assignments, any
theme that has newly crossed `MIN_MEMBERS_FOR_NAMING = 3` and still reads
`'Pending naming'` gets a Sonnet name (`feature = 'reddit-intel-name-themes'`).
No separate step to run.

- Spend is capped by `feature_brakes.reddit_intel` / `REDDIT_INTEL_CAP_USD` (A$10/day).
  A full replay may brush this. If the brake trips mid-rebuild the clusterer
  returns `{ paused: true }` and simply stops naming/clustering — **resume the
  remaining cohorts the next day**; the reset is already done and partial progress
  is durable (posts already assigned stay assigned).
- Watch spend live: `select coalesce(sum(estimated_cost_usd),0) from cost_telemetry
where feature='reddit-intel-name-themes' and created_at::date = current_date;`

### 6. Verify (over the run + the next ~3 daily cohorts)

Immediately after the replay:

```sql
select 'distinct_themes' k, count(*)::text v from reddit_intel_themes
union all select 'max_member_count', max(member_count)::text from reddit_intel_themes  -- MUST be < 250
union all select 'pending_naming', count(*)::text from reddit_intel_themes where title='Pending naming'
union all select 'posts_assigned', count(*)::text from reddit_post_intel where theme_id is not null;
```

Success signature: **many** themes (not ~1), `max_member_count < 250`,
`pending_naming` a small fraction (naming ran), `posts_assigned` back near total.

Then over the **next ~3 daily cohorts**, confirm the guards hold in steady state
by checking the always-ship health warn stays **silent**:

- Axiom (`ask-arthur` dataset), fn `reddit-intel-cluster`, message
  `single-attractor collapse signature` → should NOT appear.
- Also confirm NEW themes keep forming (`newThemeSeeds > 0` in the run output),
  i.e. the daily flow is seeding, not collapsing again.

### 7. Rollback (if the rebuild looks worse than the collapse)

The guards mean a "worse" outcome is unlikely, but the reset is fully reversible
from §2's backups:

```sql
-- 1. wipe the rebuilt state
delete from reddit_intel_themes;
-- 2. restore themes (incl. centroids), then junction, then post→theme map
insert into reddit_intel_themes select * from reddit_intel_themes_backup_20260713;
insert into reddit_post_intel_themes select * from reddit_post_intel_themes_backup_20260713;
update reddit_post_intel p set theme_id = b.theme_id
  from reddit_post_intel_theme_map_backup_20260713 b where b.id = p.id;
```

Verify counts match §1, then drop the backup tables once satisfied.

---

## Future improvement (only if rebuilds recur)

This is a one-off repair of a one-off collapse, so a manual serial replay is the
right cost/risk trade-off. If theme rebuilds ever become routine, build a
dedicated **serial** `reddit-intel-rebuild` Inngest fn that loops cohorts
oldest-first in a single run, reusing the already-unit-tested `assignPostsToThemes`
(see `reddit-intel-cluster.assign.test.ts`) — that turns this runbook into one
click. Not worth building for a single execution.

## Related

- `packages/scam-engine/src/inngest/reddit-intel-cluster.ts` — the guards + the
  `concurrency: 1` ceiling that makes the replay safe.
- `docs/plans/inngest-fleet-review.md` §"reddit-intel-cluster" — the diagnosis.
- `docs/plans/inngest-fleet-review-handoff.md` §1 — this as the deferred P1.
