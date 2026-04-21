# Phase 14 — Vulnerability Intelligence: Config Checklist

What has to be set (and where) to take Phase 14 from "schema applied + first scraper shipped" to "weekly data flowing + admin visibility + eventual B2B feed". Group by who acts on it.

## Already done

- ✅ **Supabase migration v63** — applied to prod (`rquomhcgnodxzkhokwni`). Creates `vulnerabilities`, `vulnerability_exposure_checks`, `vulnerability_detections`, `vulnerability_ingestion_log` + the `get_vulnerability_exposure_report` RPC + the `critical_vulnerabilities_au` view.
- ✅ **mcp-audit integration** — new `MCP-SC-005` rulepack check covers 12 MCP-specific CVEs on both the target package and its deps. `MCP-TP-README-*` scans the package README for tool-description poisoning.
- ✅ **First scraper** — `pipeline/scrapers/vulnerabilities/cisa_kev.py` and `.github/workflows/scrape-vulnerabilities.yml` (weekly Sunday 04:00 UTC).
- ✅ **Admin page** — `/admin/vulnerabilities` shows totals + recent scraper runs + top-50 critical list. Gated by existing admin cookie.

## Must set before first run

**Repo variable — `ENABLE_VULN_SCRAPER`** (GitHub → repo → Settings → Secrets and variables → Actions → Variables tab)

- Name: `ENABLE_VULN_SCRAPER`
- Value: `true`
- Effect: allows `scrape-vulnerabilities.yml` to fire on its weekly cron. Manual `workflow_dispatch` runs regardless of this variable. Same gating convention as `ENABLE_SCRAPER` (for `scrape-feeds.yml`) and `ENABLE_DEEP_INVESTIGATION` (for `deep-investigation.yml`).

No new secrets needed for Sprint 1. The existing `SUPABASE_DB_URL` secret (used by the URL scrapers) is already wired into the workflow.

## Needed for Sprint 2 (deferred)

When the next batch of scrapers lands:

| Scraper | Secret / variable | Where to get it |
|---|---|---|
| `nvd_recent.py` | `NVD_API_KEY` | Register at https://nvd.nist.gov/developers/request-an-api-key — raises rate limit from 5→50 req/30s |
| `github_advisory.py` | `GITHUB_TOKEN` with `read:security_events` scope | GitHub fine-grained PAT. Already have one for Reddit; may need scope expansion |
| `msrc_api.py` | none (public) | — |
| `chrome_releases.py`, `apple_security.py` | none (RSS) | — |
| `vendor_psirt/*` | none (RSS) | — |

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
