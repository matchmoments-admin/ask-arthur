# Ask Arthur — Living System Map

The canonical "what's currently shipped and how does it talk to itself" map. **Read this before designing any new feature** — every route, table, cron, and flag has exactly one home in this directory.

| File                                             | What you'll find                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [web-surface.md](./web-surface.md)               | All consumer pages, authenticated pages, admin pages, API routes (~120). One line per route.                                   |
| [database.md](./database.md)                     | Tables by domain area (75+), RPC index (71), trigger index (9), partitioning status, archive shadows, hygiene backlog.         |
| [background-workers.md](./background-workers.md) | Vercel crons (16), Inngest functions (35+), Python scrapers (23), GitHub Actions workflows (8), DB webhooks.                   |
| [feature-flags.md](./feature-flags.md)           | Every flag from `packages/utils/src/feature-flags.ts` (~80) + env-var groups.                                                  |
| [data-flows.md](./data-flows.md)                 | The 6 canonical flows: analyze pipeline, Reddit Intel, Phone Footprint refresh, Charity Check, Bot dispatch, Onward reporting. |

## The single home-per-fact rule

A route, table, cron, or flag is documented in **exactly one** of these files — never two. The system map is the source of truth; older docs that overlap (`ARCHITECTURE.md`, `docs/plans/*.md`) defer to it via redirect or banner.

| Existing doc                   | Role after this map                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARCHITECTURE.md`              | Retired stub. Redirects here.                                                                                                                                                     |
| `docs/plans/<feature>.md`      | Historical narrative for an in-flight build. Banner points new work at GitHub Issues via `/to-prd` + `/to-issues` (canonical artefact home — see `docs/agents/issue-tracker.md`). |
| `docs/ops/<feature>-config.md` | Operator runbook (env vars, flag flips, vendor setup, smoke tests). Different audience from system map; stays.                                                                    |
| `docs/adr/<n>-<topic>.md`      | Architectural law that specs respect. ADRs survive the system map and any spec.                                                                                                   |
| `CONTEXT.md`                   | Domain glossary. Defines vocabulary; this map describes deployed surface.                                                                                                         |

## System diagram

The arrows show flow of work, not network calls. `[hot ⚠]` marks write-frequent tables — new large indexes go on a sibling table per [ADR-0005](../adr/0005-pgvector-index-policy.md). `flag` marks surfaces gated by feature flag (default-OFF). `auth` marks routes that require a Supabase session (wrapped in `Promise.race` with a 3s/5s timeout — see [CLAUDE.md Critical Rules](../../CLAUDE.md#critical-rules)). `admin` marks routes that require HMAC token or Supabase admin role.

```
                                  ┌─────────────────────────────────────────────────┐
                                  │                  USERS / CALLERS                │
                                  │  Browsers • Mobile • Extensions • Bots • B2B    │
                                  └─────────────────────────────────────────────────┘
                                                       │
        ┌──────────────────────────────────────────────┼──────────────────────────────────────────┐
        │                                              │                                          │
        ▼                                              ▼                                          ▼
┌───────────────────┐                ┌─────────────────────────────────┐                ┌───────────────────┐
│  CONSUMER WEB     │                │   API SURFACE (apps/web/api/)   │                │   BOT WEBHOOKS    │
│  apps/web/app/    │                │                                 │                │                   │
│                   │                │  /api/analyze (core)            │                │  /webhooks/       │
│  / (landing)      │                │  /api/persona-check             │                │   telegram        │
│  /charity-check   │ ── flag        │  /api/deepfake (flag)           │                │   whatsapp        │
│  /phone-footprint │ ── flag        │  /api/breach-check              │                │   slack           │
│  /persona-check   │                │  /api/charity-check             │                │   slack/shortcuts │
│  /blog/*          │                │  /api/phone-footprint/[msisdn]  │                │   messenger       │
│  /intel/themes/   │ ── flag        │  /api/scam-{urls,contacts}/*    │                │  /bot-webhook     │
│  /intel/regulator │                │  /api/extension/* (×12)         │                │   (router)        │
│  /scam-feed,/map  │ ── flag        │  /api/{site,extension,mcp}-     │                │                   │
│  /banking,/telco  │                │    audit                        │                └───────┬───────────┘
│  /spf-assessment  │                │  /api/media/{upload,analyze}    │                        │
│  /pricing,/about  │                │  /api/report/onward             │                        │
│                   │                │  /api/badge[/domain]            │                        │
│  /login,/signup   │                │                                 │                        │
│  /app/* (16 pgs)  │ auth           │  /api/v1/* (B2B, API-key gated):│                        │
│  /app/dashboard   │                │   threats/urls,domains,wallets, │                        │
│  /app/reports     │                │   stats,trending,entities       │                        │
│  /app/threats     │                │   intel/themes,search,digest    │                        │
│  /app/billing     │                │   scams/search                  │                        │
│  /app/team,family │                │   deepfakes,clusters            │                        │
│  /app/compliance  │                │   openapi.json,usage            │                        │
│  /app/developer   │                │                                 │                        │
│  /app/exec,fraud  │                │  /api/stripe/{checkout,portal,  │                        │
│  /app/investig.   │                │    webhook}                     │                        │
│  /app/phone-fp/   │                │  /api/org/*,family/*            │                        │
│   monitors        │                │  /api/keys/* (B2B mgmt)         │                        │
│                   │                │  /api/admin/* (HMAC + role)     │                        │
│  /admin/* (10)    │ admin          │  /api/cron/* (16 routes)        │                        │
└─────────┬─────────┘                │  /api/inngest (POST/PUT/GET)    │                        │
          │                          └────────────────┬────────────────┘                        │
          │                                           │                                         │
          │   ┌───────────────────────────────────────┴────────────────────┐                    │
          │   │                                                            │                    │
          ▼   ▼                                                            ▼                    ▼
    ┌──────────────────────────────────┐                       ┌───────────────────────────────────┐
    │       MIDDLEWARE & AUTH          │                       │       SCAM ENGINE CORE            │
    │ apps/web/middleware.ts           │                       │ packages/scam-engine/             │
    │  Promise.race auth (3s budget)   │                       │  • analyzeWithClaude (Haiku 4.5)  │
    │ apps/web/lib/auth.ts             │                       │  • input-detector classify        │
    │  getUser (5s, AuthUnavailable)   │                       │  • pipeline / storeVerifiedScam   │
    │ apps/web/lib/apiAuth.ts          │                       │  • Inngest functions (35+)        │
    │  validateApiKey + usage log      │                       │  • cost-telemetry logCost helper  │
    │ apps/web/lib/adminAuth.ts        │                       │                                   │
    │  HMAC + Supabase admin role      │                       │ packages/bot-core/                │
    └──────────────────┬───────────────┘                       │ packages/types/ (Zod 4 schemas)   │
                       │                                       │ packages/utils/ (logger, rate-    │
                       │                                       │   limit, feature-flags, hash)     │
                       │                                       │ packages/breach-defence/          │
                       │                                       │ packages/extension-audit/         │
                       ▼                                       │ packages/mcp-audit/               │
    ┌──────────────────────────────────────────────────────────┴───────────────────────────────────┐
    │                              SUPABASE POSTGRES (rquomhcgnodxzkhokwni)                        │
    │                                                                                              │
    │  IDENTITY/BILLING   ANALYSIS PIPELINE       PHONE FOOTPRINT       BREACH DEFENCE             │
    │  • user_profiles    • scam_reports (HNSW) ──┐ • phone_footprints   • breaches                │
    │  • api_keys           [hot ⚠]               │ • phone_footprint_   • breach_victims_index    │
    │  • subscriptions    • verified_scams (HNSW) │   {monitors,alerts,    [service-role only]     │
    │  • organizations    • scam_entities [hot ⚠] │    refresh_queue,    • breach_sources_raw      │
    │  • org_members      • report_entity_links   │    entitlements,                               │
    │  • org_invitations  • scam_clusters         │    otp_attempts}     CHARITY CHECK             │
    │  • family_groups    • scam_{urls,contacts,  │ • telco_api_usage    • acnc_charities [hot ⚠]  │
    │  • family_members     ips,crypto_wallets}   │ • sim_swap_events,     ↓ embeddings on sibling │
    │                                             │   device_swap_events • acnc_charity_           │
    │  FEEDS / INTEL      RETENTION / ARCHIVE     │                        embeddings (HNSW)       │
    │  • feed_items       • *_archive (×11,       │ COMMERCE & CONTENT   • pfra_members            │
    │    [hot ⚠ partial    BRIN created_at)       │ • leads                                        │
    │    IVFFlat]         • scam_reports_         │ • stripe_event_log   TELEMETRY / SAFETY        │
    │  • feed_ingestion_    archive               │ • blog_posts         • cost_telemetry          │
    │    log              • feed_items_archive    │ • blog_categories      [→ daily_rollup MV]     │
    │  • feed_http_cache  • cost_telemetry        │ • email_subscribers  • feature_brakes          │
    │  • feed_summaries     [+partition shell]    │ • leads,             • verdict_feedback        │
    │  • reddit_post_intel                        │   subscriber_match_  • feedback_triage_queue   │
    │  • reddit_intel_                            │   checks               [MV, refresh 5min]      │
    │    themes                                                                                    │
    │  • reddit_intel_                            DEEPFAKE / MEDIA       BOT QUEUE                 │
    │    quotes                                   • deepfake_detections  • bot_message_queue       │
    │  • reddit_post_intel                        • media_analyses         (pg_net webhook trigger)│
    │    _themes                                  • flagged_ads          • bot_subscriptions       │
    │  • reddit_intel_daily_summary               • brand_impersonation_                           │
    │  • reddit_processed_posts                     alerts               SCANS                     │
    │                                             • known_brands         • scan_results           │
    │  71 RPCs (all SECURITY DEFINER): match_*, upsert_*, archive_*,    • sites, site_audits      │
    │     ensure_monthly_partition, refresh_*, prune_*, anonymise_*,                              │
    │     check_breach_exposure, create_scam_report, link_report_entity                           │
    │                                                                                              │
    │  9 triggers: handle_new_user, *_updated_at (×4), entity_enrichment_pending,                  │
    │     family_group_add_owner, deepfake_increment, flagged_ads_auto_escalate                    │
    └──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                       ▲
                                                       │  writes
        ┌──────────────────────────────────────────────┼──────────────────────────────────────────┐
        │                                              │                                          │
        ▼                                              ▼                                          ▼
┌──────────────────────────┐         ┌─────────────────────────────────────┐         ┌──────────────────────┐
│   INNGEST (35 functions) │         │   VERCEL CRONS (16)                 │         │   GH ACTIONS (8)     │
│  packages/scam-engine/   │         │   apps/web/app/api/cron/            │         │   .github/workflows/ │
│   inngest/               │         │                                     │         │                      │
│                          │         │   weekly-blog      0 12 * * 1       │         │   scrape-feeds       │
│  ANALYZE FAN-OUT         │         │   weekly-email     0 14 * * 1       │         │     (3/6/12/24h)     │
│  • analyze-completed-    │         │   nurture          0 23 * * *       │         │     ENABLE_SCRAPER   │
│    {report,brand,cost}   │         │   bot-queue-{sweep, every 6h        │         │   scrape-vulns       │
│  • analyze-failure       │         │     cleanup}       04:00            │         │     weekly Sun 04:00 │
│                          │         │   cost-{daily-     every 6h         │         │   ci (push+PR)       │
│  ENRICHMENT              │         │     check, weekly- Sun 22:00        │         │   promptfoo (PR fil.)│
│  • enrichment-fanout (6h)│         │     digest}                         │         │   claude-code-review │
│  • entity-enrichment (4h)│         │   vuln-retention   03:00            │         │   deep-investigation │
│  • ct-monitor (12h)      │         │   scam-reports-                     │         │   dr-pg-dump         │
│  • urlscan-enrich (4h)   │         │     retention      03:30            │         │   deploy (manual)    │
│                          │         │   ensure-partitions 02:00           │         │                      │
│  STALENESS (daily 03:00) │         │   reddit-intel-{                    │         │   23 Python scrapers │
│  • staleness-{check,     │         │     trigger        08:00            │         │     in pipeline/     │
│    ips, wallets}         │         │     retention}     04:30            │         │     scrapers/        │
│                          │         │   feedback-digest  09:00            │         │     (acnc, scamwatch │
│  VULN ENRICHMENT         │         │   health-digest    22:00            │         │     acsc, asic,      │
│  • enrich-vuln-au-ctx    │         │   pg-stuck-query-                   │         │     reddit, urlhaus  │
│  • enrich-vulns-cron(1h) │         │     watchdog       */5              │         │     openphish,       │
│                          │         │   scraper-brake-                    │         │     phishtank, cert  │
│  REDDIT INTEL            │         │     alert          */15             │         │     -au, crtsh, etc.)│
│  • reddit-intel-daily    │         └─────────────────┬───────────────────┘         └──────────┬───────────┘
│  • reddit-intel-embed    │                           │                                        │
│  • reddit-intel-cluster  │                           │  triggers/polls                        │ writes
│                          │                           ▼                                        ▼
│  SCAM ALERT / EMBED      │                  ┌────────────────────┐         (feed_items, vulnerability_iocs,
│  • scam-alert-push (3h)  │                  │ Vercel signature   │          acnc_charities, etc.)
│  • scam-report-embed     │                  │ verification +     │
│  • backfill-embed (man.) │                  │ pg_net unmetered   │
│                          │                  │ from Supabase      │
│  NEWS INTEL              │                  └────────────────────┘
│  • feed-items-embed(30m) │                           ▲
│  • feed-retention (2:30) │                           │  pg_net INSERT trigger
│  • feed-sync-verified-   │                           │
│    scams (weekly)        │       ┌───────────────────┴───────────────────┐
│  • feed-sync-user-       │       │   bot_message_queue → /api/bot-webhook │
│    reports (weekly)      │       │   (6h sweeper safety-net)              │
│  • regulator-alert-push  │       └────────────────────────────────────────┘
│    (30m)                 │
│                          │       ┌────────────────────────────────────────┐
│  CHARITY                 │       │   FEATURE FLAGS (~80, default OFF)     │
│  • acnc-backfill-embed   │       │   packages/utils/src/feature-flags.ts  │
│                          │       │                                        │
│  PHONE FOOTPRINT         │       │   Consumer:  charityCheck, phoneFP*,   │
│  • pf-refresh-claimer(1h)│       │     deepfake, mediaAnalysis,           │
│  • pf-refresh-monitor    │       │     scamFeed, emailSecurity (ON)       │
│  • pf-pdf-render         │       │   B2B:       redditIntelB2bApi,        │
│                          │       │     scamsSearchB2bApi, vuln*           │
│  HOUSEKEEPING (nightly)  │       │   Breach:    bd{DnsDrift, BreachIndex, │
│  • cost-telem-ret (04:00)│       │     ExtensionWarning, PwdRotate,       │
│  • phone-fp-ret (03:15)  │       │     B2bExposure, ClassActions,         │
│  • reddit-procd-posts-   │       │     Aftermath, Typosquat, BreachScore, │
│    ret (03:45)           │       │     Recovery, SecondWave}              │
│  • telco-events-ret(4:30)│       │   Reddit:    redditIntel{Ingest,       │
│  • archive-shadows(05:00)│       │     Dashboard, Email, B2bApi,          │
│                          │       │     PublicPages}                       │
│  CLUSTER/RISK            │       │   Auth:      auth, billing, multi-     │
│  • cluster-builder (4:00)│       │     Tenancy, corporateOnboarding       │
│  • risk-scorer (6h)      │       │   Pipeline:  analyzeInngestWeb (canary)│
│                          │       │                                        │
│  FEEDBACK LEARNING       │       │   Server-only flags use FF_*;          │
│  • feedback-triage-      │       │     consumer-visible use NEXT_PUBLIC_  │
│    refresh (5m, MV)      │       │     FF_*                               │
│                          │       │                                        │
│  ONWARD REPORTING        │       │   Per-feature cost brakes:             │
│  • {scamwatch, acma,     │       │     VULN_AU_ENRICHMENT_CAP_USD ($5)    │
│    report-cyber, idcare, │       │     REDDIT_INTEL_CAP_USD ($10)         │
│    feed} (event-driven)  │       │     PHONE_FOOTPRINT_CAP_USD ($5)       │
│                          │       │     DAILY_COST_THRESHOLD_USD ($2)      │
│  • meta-brp-report (6h)  │       └────────────────────────────────────────┘
└──────────────────────────┘
```

## Monorepo layout

```
ask-arthur/
├── apps/
│   ├── web/                    # @askarthur/web — Next.js 16 (Turbopack, React 19)
│   ├── extension/              # @askarthur/extension — Chrome/Firefox (WXT, React 19)
│   └── mobile/                 # @askarthur/mobile — React Native (Expo 54)
│
├── packages/
│   ├── types/                  # @askarthur/types — Zod 4 schemas, TS interfaces
│   ├── supabase/               # @askarthur/supabase — Client factories (server/browser/middleware)
│   ├── utils/                  # @askarthur/utils — Logger, hash, rate-limit, feature-flags
│   ├── scam-engine/            # @askarthur/scam-engine — Claude analysis, pipeline, Inngest
│   ├── bot-core/               # @askarthur/bot-core — Bot formatters, webhook verify, queue
│   ├── extension-audit/        # @askarthur/extension-audit — Chrome extension security scanner
│   ├── mcp-audit/              # @askarthur/mcp-audit — MCP server + AI skill security scanner
│   └── breach-defence/         # @askarthur/breach-defence — AU Breach Index, DNS drift, typosquat, recovery
│
├── tooling/
│   └── typescript/             # @askarthur/tsconfig — Shared TS configs
│
├── pipeline/
│   └── scrapers/               # Python threat-feed and intel scrapers (23 files; see background-workers.md)
│
├── supabase/migrations/        # Migration SQL files (v2–v122; see database.md)
├── docs/
│   ├── system-map/             # ← you are here
│   ├── adr/                    # Architectural decision records
│   ├── plans/                  # Historical narratives for in-flight features
│   ├── ops/                    # Operator runbooks (env vars, vendor setup, smoke tests)
│   ├── specs/                  # Spec-driven feature workflow output (see /spec-feature skill)
│   ├── grants/                 # Grant application drafts
│   └── policy/                 # Policy submission templates
├── turbo.json
├── pnpm-workspace.yaml
└── .npmrc
```

## Headline numbers

| Domain                                     | Count | File                                             |
| ------------------------------------------ | ----: | ------------------------------------------------ |
| Consumer pages (public)                    |   ~30 | [web-surface.md](./web-surface.md)               |
| Authenticated pages (`/app/*`, `/admin/*`) |   ~26 | [web-surface.md](./web-surface.md)               |
| API routes                                 |  ~120 | [web-surface.md](./web-surface.md)               |
| Bot platforms wired up                     |     5 | [web-surface.md](./web-surface.md)               |
| Postgres tables                            |   75+ | [database.md](./database.md)                     |
| Postgres RPCs (all `SECURITY DEFINER`)     |    71 | [database.md](./database.md)                     |
| Postgres triggers                          |     9 | [database.md](./database.md)                     |
| Archive shadow tables                      |    11 | [database.md](./database.md)                     |
| Migrations (v2 → v122)                     |   121 | [database.md](./database.md)                     |
| Vercel cron routes                         |    16 | [background-workers.md](./background-workers.md) |
| Inngest functions                          |   35+ | [background-workers.md](./background-workers.md) |
| Python scrapers                            |    23 | [background-workers.md](./background-workers.md) |
| GitHub Actions workflows                   |     8 | [background-workers.md](./background-workers.md) |
| Feature flags                              |   ~80 | [feature-flags.md](./feature-flags.md)           |
| Canonical data flows                       |     6 | [data-flows.md](./data-flows.md)                 |

## When to update which file

- **Add or remove a page / route** → [web-surface.md](./web-surface.md)
- **Add or change a table, RPC, or trigger** → [database.md](./database.md)
- **Add a cron, Inngest function, or scraper** → [background-workers.md](./background-workers.md)
- **Add a feature flag or env var** → [feature-flags.md](./feature-flags.md)
- **Add a canonical end-to-end flow worth narrating** → [data-flows.md](./data-flows.md)

If a change touches two of the above, update both. The single-home-per-fact rule is about a fact's home — flows are allowed to reference routes and tables; the route still lives in `web-surface.md`, the table still lives in `database.md`.
