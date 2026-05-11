# Phase 14 — Vulnerability Intelligence: Config Checklist

**Status: Sprints 0–2 shipped to prod 2026-04-21/22** (PRs #5, #6, #8 — migrations v63 + v64 applied to Supabase project `rquomhcgnodxzkhokwni`). Inngest cron cadence trimmed 2026-05-02 (PR #76). What has to be set (and where) to take Phase 14 from "schema + scrapers running" to "Sprint 6 enrichment depth shipped" + eventual B2B feed (Sprint 4). Group by who acts on it.

## Already done (Sprints 0–2)

- ✅ **Migration v63 — VIDB schema** (PR #5, 2026-04-21). Creates `vulnerabilities`, `vulnerability_exposure_checks`, `vulnerability_detections`, `vulnerability_ingestion_log` + the `get_vulnerability_exposure_report` RPC + the `critical_vulnerabilities_au` view.
- ✅ **Migration v64 — risk-tracking** (PR #6, 2026-04-21). Adds patched-in versions, EPSS scores, lifecycle status, disposition fields.
- ✅ **mcp-audit integration** (PR #5) — new `MCP-SC-005` rulepack check covers 12 MCP-specific CVEs on both the target package and its deps. `MCP-TP-README-*` scans the package README for tool-description poisoning.
- ✅ **Sprint 1 scraper** — `pipeline/scrapers/vulnerabilities/cisa_kev.py` and `.github/workflows/scrape-vulnerabilities.yml` (weekly Sunday 04:00 UTC).
- ✅ **Sprint 2 scrapers** (PR #8, 2026-04-22) — `nvd_recent.py`, `osv_feed.py`, `github_advisory.py`, plus enhanced `cert_au.py::scrape_vulnerabilities()` extracting CVE IDs from ACSC advisories. `common/vuln_db.py::bulk_upsert_vulnerabilities` helper. Workflow gated by `vars.ENABLE_VULN_SCRAPER`.
- ✅ **Inngest AU-context enrichment** (PR #8) — `packages/scam-engine/src/inngest/enrich-vulnerability.ts`, hourly cron, gated by `ffVulnAuEnrichment`, braked via `feature_brakes.vuln_au_enrichment`, full `cost_telemetry` instrumentation. Cadence trimmed 2026-05-02 (PR #76).
- ✅ **Admin page** — `/admin/vulnerabilities` shows totals + recent scraper runs + top-50 critical list. Gated by existing admin cookie.

## Must set before first run

**Repo variable — `ENABLE_VULN_SCRAPER`** (GitHub → repo → Settings → Secrets and variables → Actions → Variables tab)

- Name: `ENABLE_VULN_SCRAPER`
- Value: `true`
- Effect: allows `scrape-vulnerabilities.yml` to fire on its weekly cron. Manual `workflow_dispatch` runs regardless of this variable. Same gating convention as `ENABLE_SCRAPER` (for `scrape-feeds.yml`) and `ENABLE_DEEP_INVESTIGATION` (for `deep-investigation.yml`).

## Secrets needed for live Sprint 2 scrapers

The Sprint 2 scrapers ship code-complete; supply these secrets to activate full coverage. Without them, each scraper logs a clean skip and the workflow stays green.

| Scraper              | Secret / variable                                | Where to get it                                                                                      |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `nvd_recent.py`      | `NVD_API_KEY`                                    | Register at https://nvd.nist.gov/developers/request-an-api-key — raises rate limit from 5→50 req/30s |
| `github_advisory.py` | `GITHUB_TOKEN` with `read:security_events` scope | GitHub fine-grained PAT. Already have one for Reddit; may need scope expansion                       |
| `osv_feed.py`        | none                                             | —                                                                                                    |
| `cisa_kev.py`        | none                                             | —                                                                                                    |

## Needed for Sprint 6 (Enrichment depth & scoring — scoped 2026-05-11)

Plan-only as of 2026-05-11. Allocate secrets/vars when each workstream PR opens. See ROADMAP.md → Phase 14 → Sprint 6 for the full workstream list.

| Workstream              | Secret / variable                                                                                                                   | Where to get it                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| WS-A AUSCERT            | none (public bulletin index)                                                                                                        | —                                                                                                     |
| WS-B MSRC               | none (public CVRF API)                                                                                                              | —                                                                                                     |
| WS-C EPSS daily refresh | none (FIRST.org free)                                                                                                               | —                                                                                                     |
| WS-E VulnCheck SSVC     | `VULNCHECK_API_KEY`                                                                                                                 | Free Community tier at https://vulncheck.com/account                                                  |
| All workstreams         | per-feature cost-cap env vars (`AUSCERT_INGEST_CAP_USD`, `MSRC_INGEST_CAP_USD`, `EPSS_REFRESH_CAP_USD`, `VULNCHECK_INGEST_CAP_USD`) | Set to `1` or higher integer; non-numeric values silently disable brakes per the `parseFloat` footgun |

## Sprint 3 — Extension hardening (deferred; vendor PSIRT feeds)

When Sprint 3 ships extension-hollowing detection + DOM-clickjacking, may incorporate vendor PSIRT feeds:

| Scraper                                   | Secret / variable | Where to get it |
| ----------------------------------------- | ----------------- | --------------- |
| `chrome_releases.py`, `apple_security.py` | none (RSS)        | —               |
| `vendor_psirt/*`                          | none (RSS)        | —               |

## Needed for Sprint 4 (B2B API)

When `/api/v1/vulnerabilities/*` ships:

- **Feature flag** `NEXT_PUBLIC_FF_VULN_API` (or similar) — add to `packages/utils/src/feature-flags.ts`, gate the new routes until the first B2B customer is onboarded
- **API key scope** — extend the existing `api_keys` row shape to mark keys authorized for the vuln endpoints; reuse `validateApiKey` from `@/lib/apiAuth`

## Needed for Sprint 5 (consumer tools)

- **Tesseract decision** — if the image-injection scan uses `tesseract.js`: add to `packages/scam-engine/package.json`. If we use the Claude-vision extraction path (recommended): no new deps
- **Rate limit bucket** — MCP Config Safety Check accepts paste-in configs; add its own rate limit entry in `packages/utils/src/rate-limit.ts` (suggested: 5/hour per IP since parsing is cheap but scanning N servers is not)

## Feature-flag naming (reserve these names to avoid drift)

Not yet added to `packages/utils/src/feature-flags.ts`, but reserve:

- `ffVulnIntelDashboard` — gate the `/admin/vulnerabilities` page publicly (currently admin-only — no gate needed)
- `ffVulnB2BApi` — gate the B2B endpoints until first customer
- `ffMcpTrifectaScanner` — gate the Sprint 4 composition scanner
- `ffExtensionHollowing` — gate the Sprint 3 version-diff detector

None of these are strictly required before the underlying code ships, but naming them now avoids bike-shedding later.

## Smoke tests (post-deploy)

1. Visit `/admin/vulnerabilities` (after admin login) — should render "No runs yet" empty states.
2. Trigger `scrape-vulnerabilities.yml` via `workflow_dispatch` (feed = `cisa_kev`) — should finish in ~30-60s and write ~1200 rows.
3. Re-visit `/admin/vulnerabilities` — counters populate, latest run row appears, critical list fills.
4. Scan `mcp-remote@0.8` via the unified scanner UI — the new `MCP-SC-005-*` check should fire on CVE-2025-6514 and auto-fail the scan.

## What to **not** set

- Do **not** enable `ENABLE_VULN_SCRAPER=true` until v63 migration shows "applied" in Supabase. (It does — this is fine to set now.)
- Do **not** add any new Vercel env vars for Sprint 1; the web app changes are backend-only and use the existing Supabase service-role credentials.
