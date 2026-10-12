# Clone-Watch-only mode — runbook

**Decision (2026-10-12, founder):** run Clone Watch only. The platform cost about
US$106/mo for ~20 checks, 2 users and no revenue over 30 days; Clone Watch is the
differentiated asset (4,094 lookalikes across 218 brands, 195 later live phishing)
and the SPF obligations start 31 March 2027. Target run cost about US$22/mo.
Plan: `~/.claude/plans/elegant-jingling-aho.md` (local). This file holds no data
or secrets.

Everything here is reversible: the code stays, the schema stays, and the full
database is archived locally before any table is emptied.

---

## 1. What is paused, and what pauses it

| Surface                    | Mechanism                                                                                                                            | Enforced at                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Background jobs            | `FF_CLONE_WATCH_ONLY=true` → `/api/inngest` serves only `CLONE_WATCH_KEEP_IDS`; the next sync deregisters the rest (nothing deleted) | `apps/web/app/api/inngest/route.ts`, `apps/web/lib/cloneWatchOnly.ts` |
| Every non-Clone-Watch API  | middleware → `503 {"error":"paused"}` + `Retry-After: 86400`                                                                         | `apps/web/middleware.ts` (first check, no network)                    |
| Every non-Clone-Watch page | middleware → `307` to `/paused`                                                                                                      | same                                                                  |
| Homepage checker           | `NEXT_PUBLIC_FF_CLONE_WATCH_ONLY=true` → Clone Watch hero instead of `ScamChecker` (build-time inlined: **redeploy after flipping**) | `apps/web/app/page.tsx`                                               |
| Sitemap                    | paused routes omitted while the server flag is on                                                                                    | `apps/web/app/sitemap.ts`                                             |
| Alert canary               | skips the liveness floors of `scraper-brake-alert` and `feedback-digest` (`CLONE_WATCH_ONLY_PAUSED_ALERTERS`)                        | `apps/web/app/api/cron/alerting-canary/route.ts`                      |
| Health digest              | skips Check 2 (`feed_health` / scrapers); records `feeds_skipped: true`. Checks 1, 3, 4 (Clone Watch Lanes) and 5 still run          | `apps/web/app/api/cron/health-digest/route.ts`                        |
| Vercel crons               | **removed from `apps/web/vercel.json`** — crons cannot be flag-gated (entries in §3)                                                 | `apps/web/vercel.json`                                                |
| Scrapers / GH workflows    | repo variables set to `false` (§4)                                                                                                   | GitHub → Settings → Variables                                         |
| Bots, inbound email        | webhooks deregistered at the vendor (§5)                                                                                             | vendor dashboards                                                     |

The allowlist (one home: `apps/web/lib/cloneWatchOnly.ts`) keeps: `/`, `/blog*`,
`/about`, `/privacy`, `/terms`, `/contact`, `/paused`, `/clone-watch*`,
`/clone-report*`, `/brand-exposure`, `/admin*`, `/unsubscribe`, `/go/*`, site files
and static assets; APIs `/api/clone-list-request`, `/api/clone-watch/*`,
`/api/brand-stewardship/*`, `/api/brand-exposure`, `/api/webhooks/resend`,
`/api/subscribe`, `/api/unsubscribe`, `/api/unsubscribe-one-click`, `/api/leads`,
`/api/events`, `/api/stripe/webhook`, `/api/brand/checkout`, `/api/inngest`,
`/api/admin/*`, and the nine kept `/api/cron/*` routes. `/unsubscribe` +
`/api/unsubscribe*` stay because every brand email carries an unsubscribe link.

Guarded by `apps/web/__tests__/cloneWatchOnly.test.ts`: every keep id is a real
registered function, every `shopfront-clone-*` / `clone-watch-*` function is kept,
every Lane in `lib/laneHealth.ts` belongs to a kept function, every cron left in
`vercel.json` is allowlisted, and the paused alerters have no cron.

### Kept Inngest functions (27)

`shopfront-nrd-daily-ingest`; `shopfront-clone-` enforcement-execute,
enforcement-plan, feed-platform, fp-cluster-digest, haiku-preclassify,
lifecycle-recheck, netcraft-auto, netcraft-issue, netcraft-reconcile, notify-brand,
notify-brand-prepare, notify-weaponised, reemergence-monitor, urlscan-retrieve,
urlscan-scan-one, urlscan-submit, weekly-digest; `clone-watch-` enrich-attribution,
internal-digest, month-end-liveness, report-summary; `report-brand-stewardship`;
`report-onward-openphish`, `report-onward-apwg` (the two events
`shopfront-clone-enforcement-execute` emits); `cost-telemetry-retention`;
`billing-ingest-nightly`.

Dropped functions that only ran on a manual trigger and touch Clone Watch data:
`known-brands-discover` and `brand-register-refresh` (brand-contact coverage). They
cannot be fired while the mode is on; flip the flag off and re-sync to run them.

## 2. Turning it on

1. Merge the PR (§6 merge order). 2. In Vercel production set
   `FF_CLONE_WATCH_ONLY=true` and `NEXT_PUBLIC_FF_CLONE_WATCH_ONLY=true`, then redeploy
   (a commit with `[build]`, or `vercel redeploy dpl_<id>`). 3. `PUT /api/inngest` and
   confirm in the Inngest dashboard that only the 27 functions above are registered —
   a rejected sync is silent apart from the PUT body. 4. Set
   `FF_CLONE_WATCH_FEED_ENTITIES=false` and the paid flags of paused features
   (`FF_MONTHLY_INTEL_BLOG`, reddit intel, etc.) as belt-and-braces. 5. GitHub
   variables and vendors (§4, §5). 6. Soak 48 h: Clone Watch Lanes green in
   health-digest, Outcome Rows for ingest / preclassify / urlscan / Netcraft / recheck,
   `cost_telemetry` shows only Clone Watch features.

Preview checks with the flag on: `curl -i /api/analyze` → 503 `paused`;
`/clone-watch` and `/blog` render (check body text, not just status);
`/charity-check` → 307 `/paused`; a kept cron route still demands `CRON_SECRET`.

## 3. Vercel cron entries removed from `apps/web/vercel.json`

Paste back into the `crons` array to restore (verbatim from the pre-change file):

```json
  {
    "path": "/api/cron/weekly-email",
    "schedule": "0 14 * * 1"
  },
  {
    "path": "/api/cron/nurture",
    "schedule": "0 23 * * *"
  },
  {
    "path": "/api/cron/bot-queue-sweep",
    "schedule": "0 */6 * * *"
  },
  {
    "path": "/api/cron/bot-queue-cleanup",
    "schedule": "0 4 * * *"
  },
  {
    "path": "/api/cron/vuln-retention",
    "schedule": "0 3 * * *"
  },
  {
    "path": "/api/cron/scam-reports-retention",
    "schedule": "30 3 * * *"
  },
  {
    "path": "/api/cron/shop-checks-retention",
    "schedule": "45 3 * * *"
  },
  {
    "path": "/api/cron/ensure-partitions",
    "schedule": "0 2 * * *"
  },
  {
    "path": "/api/cron/reddit-intel-trigger",
    "schedule": "0 1,7,13,19 * * *"
  },
  {
    "path": "/api/cron/reddit-intel-retention",
    "schedule": "30 4 * * *"
  },
  {
    "path": "/api/cron/feedback-digest",
    "schedule": "0 9 * * *"
  },
  {
    "path": "/api/cron/scraper-brake-alert",
    "schedule": "*/15 * * * *"
  }
```

Kept (9): clone-lead-digest, clone-watch-retention, onward-retention,
cost-daily-check, cost-weekly-digest, pg-stuck-query-watchdog, axiom-fleet-watch,
health-digest, alerting-canary (`CLONE_WATCH_KEPT_CRON_PATHS`).

**`ensure-partitions` check before relying on its removal.** It maintains monthly
partitions on `cost_telemetry_partitioned`, `scam_reports_partitioned` and
`feed_items_partitioned` (v71 scaffold, v234). The code writes the unpartitioned
tables, so the shells should receive no rows — but confirm in prod
(`SELECT relkind FROM pg_class WHERE relname = 'cost_telemetry'` must be `r`, not
`p`) before the next month boundary. If `cost_telemetry` was ever cut over to the
partitioned parent, put this cron back or every Clone Watch `logCost()` fails once
the pre-created partitions run out.

## 4. GitHub repo variables and workflows

| Variable / workflow           | Paused value                        | Restore value                      |
| ----------------------------- | ----------------------------------- | ---------------------------------- |
| `ENABLE_SCRAPER`              | `false`                             | `true`                             |
| `ENABLE_VULN_SCRAPER`         | `false`                             | `true`                             |
| `ENABLE_DEEP_INVESTIGATION`   | `false`                             | `true`                             |
| `ENABLE_CHARITY_CHECK_INGEST` | `false`                             | `true`                             |
| `promptfoo` workflow          | `gh workflow disable promptfoo.yml` | `gh workflow enable promptfoo.yml` |

Kept running: `ci`, `claude-code-review`, `clone-watch-linkedin`,
`clone-watch-enricher-healthcheck`. `clone-watch-linkedin` renders
`/admin/report-card`, which the allowlist keeps.

## 5. External services

| Service                                                  | Paused by                                                                                                                                        | Restore                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Telegram consumer bot                                    | `deleteWebhook` (token kept — admin alerts use it)                                                                                               | `setWebhook` to `https://askarthur.au/api/webhooks/telegram` with the secret token |
| WhatsApp / Messenger                                     | remove the Meta webhook subscriptions                                                                                                            | re-subscribe per `docs/ops/meta-bots-config.md`                                    |
| Slack                                                    | remove the event subscription                                                                                                                    | re-add the Request URL                                                             |
| Cloudflare Email Routing (`intel.askarthur.au`, `scan@`) | disable the routing rule                                                                                                                         | re-enable; see `docs/ops/inbound-email-config.md`                                  |
| Unused vendors                                           | cancel / revoke: HIBP, Twilio number, Hive, APIVoid, Vonage, LeakCheck, IPQualityScore, Paddle; check Plausible plan and any X/Twitter paid tier | re-subscribe, re-add keys                                                          |

Stripe stays: `/api/stripe/webhook` and `/api/brand/checkout` serve the brand pilot.

## 6. Merge order (important)

The `vercel.json` cron removal is **not** flag-gated: it takes effect on the first
production deploy after merge, flag or no flag. Until `FF_CLONE_WATCH_ONLY=true` is
set, the Monday 08:00 UTC `alerting-canary` will report `scraper-brake-alert` and
`feedback-digest` below their floors, and the scraper brake alert / feedback digest
no longer run. So set the two flags in the same session as the merge (§2), or hold
the merge until you are ready to switch.

## 7. Where the archive lives

- Local: `~/Archives/askarthur/db-<date>/` (outside every repo — the repo is public).
  Contains the full `pg_dump --format=custom` (zstd), a separate `auth` data dump,
  the plain-SQL schema baseline, the `supabase db dump` set, `SHA256SUMS` and
  `manifest.txt` (per-table rows + size at dump time).
- Second copy: `<record the external drive / iCloud path here>` — SHA-256 verified.
- Browsable restore: local Postgres 17 database `askarthur_verify`.

## 8. Restore, in order

1. If the restored database will exceed 500 MB, upgrade the Supabase project from
   Free first (Pro), then re-add PITR / compute if wanted.
2. For each truncated table, from the local dump (the schema is still live):
   `pg_restore --data-only --no-owner -d "$DB" -t <table> <dump>`. Restore parents
   before children (check `pg_constraint`); disable triggers if a table's trigger
   would re-fire side effects.
3. Set `FF_CLONE_WATCH_ONLY=false` and `NEXT_PUBLIC_FF_CLONE_WATCH_ONLY=false`; paste
   the §3 crons back into `apps/web/vercel.json`; set the §4 variables back to
   `true` and re-enable `promptfoo`.
4. Rebuild (commit with `[build]`), then `PUT /api/inngest` and confirm the full
   fleet registers.
5. Re-register the bot, Cloudflare and Stripe webhooks (§5).
6. Turn features back on one at a time, each with the pre-flip checklist in
   `docs/system-map/feature-flags.md`.

Effort: under a day into the existing project; 1–3 days into a new Supabase project
(restore from the `supabase db dump` set, then re-point env vars).
