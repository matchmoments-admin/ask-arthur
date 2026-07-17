# Registrant-Intelligence — staged flag-activation runbook (handoff)

Activate the 2026-07-17 registrant-intelligence features and prove each one on
real prod data. All are $0 (free-tier). Migrations v234–v237 are already applied.

**Status 2026-07-17: all four flags are SET to `true` in the prod env.** They go
live on the first deployment that actually builds — see "THE TRAP" below, which
is the thing that will bite you. Verification then happens on one enricher run
(13:30 UTC, or a manual Inngest invoke).

The steps below are the **verification** procedure, one section per feature. They
are no longer a one-flag-per-day gate — see "Why all four at once" in the ground
state. Execute the verification for 1, 3 and 4; **Step 2 is inert** (flag on, but
zero `.au` input has ever existed — #772), so there is nothing to verify there
until an `.au` source lands.

Order of operations that actually works:

```
vercel env add FF_X production   →   merge a PR with [build] in the message
                                 →   confirm deploy reaches Ready (NOT Canceled)
                                 →   invoke the enricher
                                 →   run the verification SQL below
```

---

## Ground state (verified 2026-07-17)

- **Master gate `FF_CLONE_WATCH_ATTRIBUTION` is already ON in prod** — the
  `clone-watch-enrich-attribution` cron runs daily at **13:30 UTC** and calls
  whoisjson ~32×/day (last call 13:33 UTC). So the four new flags will take
  effect on the next daily run once flipped; no master-gate blocker.
- **All 4 flags are now set to `true` in the Vercel prod env (2026-07-17):**
  `FF_RDAP_LOOKUP`, `FF_CLONE_WATCH_AU_REGISTRANT`, `FF_CLONE_CAMPAIGNS`,
  `FF_CLONE_WATCH_KIT_PIVOTS`. They go live on the first deployment that
  actually **builds** (see the trap below) and are verified on the next
  enricher run.
- **Why all four at once, not one per day** (superseding this runbook's original
  staging): all four are $0 free-tier, every write is additive (a JSONB key or a
  nullable column), every rollback is "set `false` + redeploy", and all four are
  unit-tested. The usual argument for staging — _if it breaks you won't know
  which flag_ — doesn't hold: they write to three disjoint places
  (`attribution.whois.source`, `campaign_key`, `attribution.kit_siblings`), so
  attributing a failure is trivial. The one thing genuinely worth watching is the
  campaign backfill's IO (1,085 rows at 500/run) — that's an observation, not a
  reason to wait days.
- **urlscan search quota gate (Step 4) — CLEARED 2026-07-17:** `search` shows
  day 1000 limit / 0 used, minute 120 / 0. The feature caps at 10/run ≈ **1% of
  the daily allowance**.
- Data available to verify against (2026-07-17): 1,085 enriched alerts awaiting
  campaign backfill (Step 3, ~3 runs at 500/run); 42 `likely_phishing` alerts in
  the 35-day window (Step 4); **0 `.au` alerts, ever (Step 2 blocked)**.
- The Vercel CLI in the repo is authenticated against the `ask-arthur` prod
  project, so `vercel env add` can do the flips without operator involvement.
  The redeploy must come from a `[build]`-marked merge (see the trap below).
  The Inngest "Invoke" click is genuinely manual — the enricher is cron-only.
- **Vercel incident 2026-07-17 (context, not a standing issue):** a
  "GitHub-linked deployments" incident (23:09 UTC → recovering 00:07 UTC) left
  builds stuck in `Initializing` for 20+ min. If deploys hang and nothing else
  explains it, check <https://www.vercel-status.com/> before debugging config.
  CLI deploys were unaffected during that incident.
- whoisjson is at ~226 calls / 7 days — approaching its 1,000/mo free cap, so
  `FF_RDAP_LOOKUP` (first below) also relieves quota pressure.

## How to flip a server flag (each step)

These are bare `FF_*` (server-only) env vars, read at runtime via `readBoolEnv`.

1. Set on Vercel prod — **use `--value`, never a stdin pipe:**

   ```bash
   vercel env add FF_<NAME> production --value true --no-sensitive --force --yes
   ```

   - **Piping into `vercel env add` does not work** on CLI 55.0.0. Both
     `printf 'true' |` and `echo true |` create the variable with an **empty
     value**. `vercel env ls` then shows the var present and looks fine, while
     `readBoolEnv("")` is `false` — i.e. the flag reads as OFF while appearing set.
   - `--no-sensitive` matters for a **flag**: sensitive vars cannot be read back
     (`vercel env pull` returns them empty), so you can never verify what you
     stored. Flags aren't secrets — store them readable. (`FF_CLONE_WATCH_ATTRIBUTION`
     is non-sensitive, which is why it's verifiable.)
   - `--force` overwrites an existing value (otherwise the add is a no-op).

2. **Verify the VALUE, not the var's existence** — `vercel env ls` only proves a
   var exists:

   ```bash
   vercel env pull /tmp/.env.check --environment=production --yes
   grep -E '^FF_' /tmp/.env.check     # must show FF_<NAME>="true", not ""
   rm -f /tmp/.env.check
   ```

3. **Redeploy — and you MUST put `[build]` in the commit message.** Env vars are
   injected at deploy; a running deployment won't see a new/changed var until a
   fresh deploy.

   **THE TRAP (cost us a whole cycle on 2026-07-17).** An env-only change touches
   NO files. `apps/web/vercel-ignored-build-step.sh` skips the build whenever every
   changed file matches its allowlist — and `docs/` + `*.md` are allowlisted. So
   the obvious move, "flip the flag and merge the docs commit recording it",
   **skips its own build and the flag never goes live.** The runbook cannot
   deploy itself.

   **It fails silently.** The deployment lands in state `CANCELED`, which sits
   next to a merged PR looking like success. `vercel ls --prod` still shows a
   Ready production deployment (the OLD one). No check goes red. The only tell is
   `vercel ls` showing `CANCELED` and the prod `Ready` deploy predating your flip.

   Working options, in order of preference:
   - **Merge a PR whose commit message contains `[build]`** (PR #774 added this
     override to the ignore script). Forces a build regardless of changed files.
     This is the one to use for a flag flip.
   - Merge a PR that touches real code (`apps/web/`, `packages/`) — builds
     normally.
   - Vercel dashboard → Deployments → ⋯ → **Redeploy**. (On 2026-07-17 this
     wedged in `Initializing` for 18+ min without ever starting a build — treat
     it as unreliable.)
   - **`vercel redeploy <url>` does NOT work** on CLI 55.0.0 — it hangs and
     creates no deployment at all, with or without `--non-interactive --no-wait`.
   - An empty commit to `main` is NOT an option — `.claude/hooks/git-commit-guard.sh`
     blocks committing on `main`, by design.

   **Always confirm the deploy reached `Ready`, not `CANCELED`:**

   ```bash
   vercel ls ask-arthur | head -6   # newest prod row must be Ready AND newer than your flip
   ```

4. Confirm the var is live: it should show in the next function invocation's env.

**Rollback (any flag):** set the var to `false` (or remove it) + redeploy. All
data written is additive JSONB / a nullable column — nothing to clean up; the
feature simply stops writing new values. No migration reversal needed.

## How to trigger the code path (don't just wait a day)

The enricher now has a manual trigger (added in #775 — it was the only
clone-watch stage without one). Fire it directly:

```bash
KEY=$(vercel env pull /tmp/.e --environment=production --yes >/dev/null 2>&1; \
      grep '^INNGEST_EVENT_KEY=' /tmp/.e | cut -d= -f2- | tr -d '"'; rm -f /tmp/.e)
curl -s -X POST "https://inn.gs/e/$KEY" -H "Content-Type: application/json" \
  -d '{"name":"shopfront/clone.enrich-attribution.manual-trigger.v1","data":{}}'
```

**A new/changed Inngest TRIGGER needs an app re-sync, or the event goes nowhere.**
Inngest keeps its own copy of the function definitions; a Vercel deploy does not
always refresh it. The event API returns `{"status":200}` regardless — it accepts
the event, finds no function registered for that name, and silently runs nothing.
Force the re-sync after deploying a trigger change:

```bash
curl -s -X PUT https://askarthur.au/api/inngest
# {"message":"Successfully registered","modified":true}  ← "modified":true means it WAS stale
```

Or: Inngest dashboard → function → **Invoke** (empty payload), or wait for 13:30 UTC.

- The upstream urlscan stages also have manual triggers:
  `shopfront/clone.urlscan-submit.manual-trigger.v1`,
  `shopfront/clone.urlscan-retrieve.manual-trigger.v1`,
  `shopfront/clone.lifecycle-recheck.manual-trigger.v1`.

### What each flag can actually be verified against (measured 2026-07-17)

Triggering a run proves nothing if the relevant worklist is empty. Check first:

| Flag                           | Worklist query                                                                                           | 2026-07-17                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `FF_CLONE_CAMPAIGNS`           | `attribution IS NOT NULL AND campaign_key IS NULL`                                                       | **1,085** — verifiable now       |
| `FF_CLONE_WATCH_KIT_PIVOTS`    | `urlscan_classification='likely_phishing' AND attribution->'kit_siblings' IS NULL`                       | **42** — verifiable now          |
| `FF_RDAP_LOOKUP`               | `source='nrd' AND urlscan_scanned_at IS NOT NULL AND attribution IS NULL AND first_seen_at >= now()-35d` | **0** — NOT verifiable on demand |
| `FF_CLONE_WATCH_AU_REGISTRANT` | any `.au` alert                                                                                          | **0** — blocked (#772)           |

**`FF_RDAP_LOOKUP` cannot be verified by triggering.** The enricher only does
WHOIS for rows where `attribution IS NULL`, and every eligible row is already
enriched. New work appears only after the daily NRD ingest (~08:30 UTC) lands new
alerts AND urlscan scans them (`urlscan_scanned_at` gates the worklist). So RDAP
verifies on the next natural cycle — the 441 currently-unenriched rows are all
`urlscan_scanned_at IS NULL` and will never enter the worklist until scanned.

## Pre-flip checklist — run BEFORE every flag (CLAUDE.md rule)

```
mcp__supabase__get_advisors  project_id=rquomhcgnodxzkhokwni  type=security
mcp__supabase__get_advisors  project_id=rquomhcgnodxzkhokwni  type=performance
```

```sql
-- Disk-IO budget top consumers (nothing new should dominate after a flip)
SELECT query, shared_blks_read + shared_blks_written AS io
FROM extensions.pg_stat_statements
ORDER BY io DESC LIMIT 25;
```

Baseline advisors today: only pre-existing INFO `rls_enabled_no_policy`. Any NEW
ERROR/WARN after a flip → roll the flag back and investigate.

---

## STEP 1 — `FF_RDAP_LOOKUP` (RDAP-first WHOIS)

**What it does:** clone-watch attribution resolves registrar/created/nameservers
via free unmetered RDAP first, whoisjson only when RDAP is empty. Adds
`whois.statuses` (clientHold/serverHold = registrar-suspended), `registrarIanaId`,
`abuseContact`. OFF ⇒ whoisjson-only (unchanged).

**Live-data pre-check (already done):** `rdap.org/domain/google.com` parses
correctly (registrar MarkMonitor, IANA 292, abuse contact, status array). The
parser is proven on real registry data.

Flip → redeploy → invoke the enricher (or wait for 13:30 UTC) → verify:

```sql
SELECT
  count(*) FILTER (WHERE attribution->'whois'->>'source' = 'rdap')      AS via_rdap,
  count(*) FILTER (WHERE attribution->'whois'->>'source' = 'whoisjson') AS via_whoisjson,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(attribution->'whois'->'statuses','[]'::jsonb)) > 0) AS with_statuses
FROM public.shopfront_clone_alerts
WHERE first_seen_at > now() - interval '2 days' AND attribution IS NOT NULL;
```

```sql
-- whoisjson volume should FALL, an rdap provider should appear
SELECT provider, count(*) FROM public.cost_telemetry
WHERE feature='whois' AND created_at > now() - interval '2 days' GROUP BY provider;
```

**PASS:** `via_rdap > 0`, a `provider='rdap'` cost row exists, whoisjson volume
drops on the next run. **WATCH:** if `via_rdap = 0` after a run, rdap.org may be
unreachable — the whoisjson fallback still works, but investigate before relying
on `statuses`.

- [ ] Flipped + redeployed
- [ ] Enricher ran; `via_rdap > 0`, statuses populate
- [ ] whoisjson volume dropped; advisors clean

---

## STEP 2 — `FF_CLONE_WATCH_AU_REGISTRANT` — **BLOCKED ON SOURCING, DO NOT FLIP**

**Status (measured 2026-07-17): this flag is a no-op. There is no `.au` data for
it to act on, and none has ever existed.** Flipping it would ship an
unverifiable flag. Skip this step and go to Step 3.

**The evidence.** `shopfront_clone_alerts` holds 1,526 rows, every one of them
`source = 'nrd'` (the whoisds newly-registered-domains feed). `.au` domains among
them: **zero, all time** — not "none in the 35-day window":

```sql
SELECT count(*) FILTER (WHERE candidate_domain LIKE '%.au') AS au_all_time,
       count(*) AS total
FROM public.shopfront_clone_alerts;   -- → au_all_time = 0, total = 1526 (2026-07-17)
```

The feed's TLD mix is new-gTLD only — `.shop` (261), `.online` (191), `.com`
(175), `.xyz` (99), `.store` (71). The whoisds free tier carries no `.au` zone,
so the clone-watch lane structurally cannot produce an `.au` candidate.

**This is a sourcing gap, not a code defect.** The RDAP `.au` parser is verified
against live registry data (`telstra.com.au` → `auData_eligibility` carries the
registrant name + ABN 33051775556, extracted and checksum-validated), and the
v236 sole-trader PII gate is in place. The code is correct and dark; it simply
has no input. Tracked in **#772** — an `.au` candidate lane (auDA zone access, or
the CT-log firehose already scoped as Phase B in ADR-0016 / #383) has to land
first.

**Re-entry criteria.** When `au_all_time > 0`, restore the original verification:
flip → redeploy → run enricher → check that `.au` alerts get an `au_registrant`
block with `abnStatus` ∈ active/cancelled/not-found/lookup-failed/no-abn,
spot-check one ABN against abr.business.gov.au, confirm `provider='auda-rdap'`
cost rows appear, and — the gate that matters — assert
`(attribution->'au_registrant' ? 'legalName')` is FALSE for any
individual/sole-trader. `ABN_LOOKUP_GUID` is already set (charity-check uses it).

- [ ] BLOCKED — do not flip until an `.au` candidate source exists

---

## STEP 3 — `FF_CLONE_CAMPAIGNS` (campaign fingerprinting + brand surface)

**What it does:** stamps `campaign_key` on each enriched alert (+ a self-draining
backfill of existing rows, 500/run) so the report card + `/api/brand-exposure`
teaser can surface "N of your lookalikes are one coordinated actor". $0.

Flip → redeploy → run enricher (a few times, or over a few days, to drain the
backfill) → verify:

```sql
SELECT
  count(*) FILTER (WHERE campaign_key IS NOT NULL)                    AS stamped,
  count(*) FILTER (WHERE campaign_key = 'insufficient')               AS insufficient,
  count(*) FILTER (WHERE attribution IS NOT NULL AND campaign_key IS NULL) AS backfill_remaining
FROM public.shopfront_clone_alerts;
-- A real campaign (>=2 domains one key) should appear for a targeted brand:
SELECT * FROM public.clone_campaigns_for_brand(
  (SELECT target_brand_normalized FROM public.shopfront_clone_alerts
   WHERE campaign_key IS NOT NULL AND campaign_key <> 'insufficient'
   GROUP BY target_brand_normalized ORDER BY count(*) DESC LIMIT 1),
  now() - interval '90 days', now());
```

**PASS:** `backfill_remaining` trends to 0 over a few runs; `clone_campaigns_for_brand`
returns ≥2-domain clusters. **Brand surface:** the next monthly report card
(`getCloneWatchReportCard`) `.campaigns` populates, and `POST /api/brand-exposure`
(with `FF_BRAND_EXPOSURE` on) returns a `campaigns: {count, largest}` block with
**no domain names**.

- [ ] Flipped + redeployed
- [ ] `backfill_remaining` draining; `clone_campaigns_for_brand` returns clusters
- [ ] brand-exposure teaser returns masked campaigns (no domain leak); advisors clean

---

## STEP 4 — `FF_CLONE_WATCH_KIT_PIVOTS` (urlscan kit siblings)

**What it does:** for confirmed `likely_phishing` clones, pivot the urlscan
Search API on the hosting IP → sibling kit deployments → `attribution.kit_siblings`.
Cap 10 searches/run, 429-aware. **Confirm urlscan search quota first:**
`GET https://urlscan.io/api/v1/quotas` with the account `URLSCAN_API_KEY` — the
`search` bucket must have headroom for ~10/day.

Flip → redeploy → run enricher → verify (need a `likely_phishing` clone):

```sql
SELECT id, candidate_domain,
       attribution->'kit_siblings'->>'reason'       AS reason,
       jsonb_array_length(COALESCE(attribution->'kit_siblings'->'siblings','[]'::jsonb)) AS siblings
FROM public.shopfront_clone_alerts
WHERE urlscan_classification='likely_phishing'
  AND attribution ? 'kit_siblings'
  AND first_seen_at > now() - interval '35 days'
ORDER BY id DESC LIMIT 20;
-- The worklist must DRAIN (no likely_phishing rows stuck without a kit_siblings block):
SELECT count(*) AS pending_pivot FROM public.shopfront_clone_alerts
WHERE urlscan_classification='likely_phishing' AND attribution IS NOT NULL
  AND attribution->'kit_siblings' IS NULL AND first_seen_at > now() - interval '35 days';
```

**PASS:** every processed row gets a `kit_siblings` block (siblings ≥ 0, or
`reason='no_ip'`); `pending_pivot` shrinks each run (op-review predicate holds).

```sql
SELECT count(*) FROM public.cost_telemetry
WHERE feature='shopfront_clone_watch' AND operation='search'
  AND created_at > now() - interval '2 days';  -- <= 10/run
```

- [ ] urlscan search quota confirmed with headroom
- [ ] Flipped + redeployed
- [ ] `kit_siblings` written (incl. `no_ip` sentinel); `pending_pivot` draining
- [ ] search cost ≤ cap/run; advisors clean

---

## Cross-feature integration (after all four are on + stable)

The point of activating these is that they COMPLEMENT the brand outputs:

- [ ] Monthly report card / LinkedIn export shows the campaigns section (the
      "N coordinated campaigns" headline) — check the next `clone-watch:export`.
- [ ] `/api/brand-exposure` teaser returns masked `campaigns` for a cloned brand.
- [ ] Registrar `clientHold` status + abuse contact are visible in the attribution
      dossier (report card / brand-stewardship email consumers — future wiring).
- [ ] Weaponisation-risk score reflects `au_registrant.abnStatus` on `.au` alerts.

## Known follow-up (NOT blocking activation — dark until wired)

- **B2 (review):** kit_siblings are stored evidence but `computeCampaignKey` does
  not yet fold shared-IP overlap into campaign grouping — two clones from the
  same kit on the same IP but different registrar won't cluster. Enhancement:
  add hosting IP / sibling-overlap as a fingerprint component, or surface
  "shares a host with N phishing sites" on the dossier. Safe to defer.
- Surface `whois.statuses` (clientHold) + `abuseContact` + `au_registrant`
  cancelled-ABN line directly in the brand-stewardship email / report card slides
  (data is populated once the flags above are on; the render is the remaining bit).

## Emergency stop

Any flag misbehaving → set it `false` + redeploy (data is additive, no cleanup).
The shared `feature_brakes.shopfront_clone_outreach` operator kill-switch pauses
the whole enricher if needed. `SHOPFRONT_CLONE_OUTREACH_CAP_USD` ($5) is the cost
backstop (all these are $0 free-tier, so the cap shouldn't trip).
