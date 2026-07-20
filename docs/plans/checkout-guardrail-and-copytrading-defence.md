# Plan — Checkout Guardrail + AI Copytrading Defence

**Status:** planning (no code/migrations applied). Intended home: `docs/plans/checkout-guardrail-and-copytrading-defence.md`.
**Source of "why":** the research report _"Two Emerging Scams and How Ask Arthur Can Fight Them"_ (skincare typosquat storefronts via Google Shopping + fake AI copytrading recruited on TikTok — TagMarkets / Sonic AI / Aitech).
**This doc supersedes the original hand-off build plan**, which was written without codebase access and assumed a ~v86 database. Production is at **v243**. ~70% of the original "build" list is already shipped; this plan is the reconciled, right-sized version.

---

## 0. Reconciliation summary (what already exists)

| Original plan assumed                                   | Reality                                                                                                                                                                            | Consequence                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Latest migration ~v86                                   | **v243**; next is **v244**                                                                                                                                                         | Re-sequence everything                                   |
| ASIC Investor Alert ingester = greenfield "build first" | **`pipeline/scrapers/asic_investor_alerts.py` runs daily**; writes ASIC domains → `scam_urls`, + one synthetic narrative `feed_item`. **Does NOT populate `scam_entities`.**       | Scraper exists; the _entity-lookup_ half is the real gap |
| URL Guard doesn't flag ASIC domains yet                 | `url-check` route looks up `scam_urls`; ASIC domains are already there → **URL Guard already flags them**                                                                          | Don't rebuild; add the name/entity dimension             |
| dnstwist port needed                                    | `packages/shopfront-glue/lexical-match.ts` = confusable + substring + Levenshtein-1 + punycode, vs `AU_BRAND_WATCHLIST` (150+ brands). `packages/breach-defence` is an empty stub. | Add brands to the watchlist; never port dnstwist         |
| Checkout payment-form trigger = new                     | `apps/extension/src/lib/commerce-detector.ts` detects checkout forms (`autocomplete="cc-"` + `action~=checkout`)                                                                   | Reuse as the trigger                                     |
| Domain-age / cert / WHOIS scoring = new                 | `shop-check-score.ts computeCompositeScore` (DOMAIN_AGE_POINTS), `whois-cached.ts`, `ct-lookup.ts`, `rdap.ts`, `weaponisation-risk.ts`                                             | Reuse the scoring engine                                 |
| "Check this shop" (web) = new                           | **Deep Shop Check** live: `/api/shop-check` → `shop_checks` → `shop-signal-enrich` (WHOIS+APIVoid+ABN), gated `FF_SHOP_SIGNAL`                                                     | Reuse as the deep/async path                             |
| Extend `known_brands` with official-domain array        | Real allowlist is `AU_BRAND_WATCHLIST[].legitimate_domains[]`; `known_brands.brand_domain` is a single-domain abuse-contact directory                                              | Edit the watchlist, not `known_brands`                   |
| Crypto-wallet rep probably not wired                    | `scam_crypto_wallets` exists (58 rows) but CryptoScamDB scraper **disabled**; **no on-chain reputation, no crypto branch in `compute_entity_risk_score`**                          | Genuinely net-new                                        |
| Reuse onward RPCs to route to ASIC                      | `get_onward_destinations` / `onward_report_log` / `provider_reports` exist, but **ASIC is not an onward destination** (only an ingest source)                                      | Adding ASIC-as-destination = enum + worker (small)       |
| Mobile share-intent for TikTok = extend                 | `expo-share-intent` already accepts text + URL + 5 images; a TikTok URL/screenshot already reaches `/api/analyze`                                                                  | No new transport; only UX + optional `url` mode          |
| Web analyze has a URL hint                              | `WebAnalyzeInputSchema` mode = `text\|image\|qrcode`; TikTok links work today as text + server URL extraction. `referrerSource` has `tiktok-inapp` (provenance, different thing)   | Typed `url` input = optional polish                      |
| Bots surface copytrading warnings                       | No copytrading branch in formatters; `recoverySteps.ts` has an `investment` block; bot "Report scam" → onward brain shipped (#827)                                                 | New `scamType` branch, small                             |
| Family UI pending                                       | Tables **and** UI exist (`app/app/family/page.tsx`, `api/family/*`)                                                                                                                | Don't block anything on it; out of scope                 |

**Advisor baseline (2026-07-21):** security advisors are all INFO `rls_enabled_no_policy` (~27 service-role/partition tables). **Zero ERRORs.** Every new table must ship an RLS policy in the same migration.

---

## 1. Guiding principles

1. **Extend, don't duplicate.** Every PR names the existing module it extends. If a PR feels like a new parallel system, stop and re-check.
2. **Brand-agnostic from day one.** Watchlist + brand-convergence Seam + org-scoped `monitored_brands` (v207) already generalize beyond skincare. Skincare = the first watchlist _entries_, not special-cased code.
3. **Dark-launch.** Default-OFF flags: extension `WXT_*` + server `NEXT_PUBLIC_FF_*` twin (follow `WXT_URL_GUARD`/`NEXT_PUBLIC_FF_URL_GUARD`).
4. **Low latency on the hot path.** Checkout warning must render _before_ card submit → cheap client signals + a fast server verdict (lexical + `scam_urls` lookup, no APIVoid). Defer APIVoid/ABN to the opt-in Deep Shop Check deep-link.
5. **Instrument everything.** `logCost()` on paid APIs; `feature_brakes` kill-switch where spend exists; new Inngest fn → `docs/inngest-brakes.md`.
6. **Migrations:** prod `rquomhcgnodxzkhokwni` via `mcp__supabase__apply_migration`, idempotent, RLS in-migration, advisors re-checked. Next free number **v244**.
7. **Don't name The Ordinary / Naturium (or any brand) in public copy** without validating via our own threat-intel pipeline first (research Caveat #1; founder Q5).

---

## 2. Founder gates

| #   | Question                                                                                                 | Blocks                  |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| Q1  | Which tiers get the Checkout Guardrail (free vs paid)? Safe Browsing (non-commercial) vs. paid Web Risk. | PR-B1 flip; PR-F1       |
| Q4  | Crypto-wallet reputation — buy a source or seed a manual scam-cluster list?                              | PR-D1                   |
| Q5  | Legal sign-off on brand-specific public claims.                                                          | PR-C1 (naming only)     |
| Q2  | Brand-impersonation monitoring funded B2B now, or allowlist stays internal?                              | Stage 3                 |
| Q3  | Timeline for TikTok Trusted Flagger + NASC partnership.                                                  | Stage 3                 |
| Q6  | Email `api@iosco.org` to request an I-SCAN API key (Bearer, 10 req/s).                                   | IOSCO ingester in PR-D1 |

None of Q1–Q5 block **PR-A1, PR-A2, PR-B1 (dark), PR-B2, PR-C1 (generic)** — Stage 1 can proceed now.

---

## 3. PR sequence

### Stage 1 — days, high credibility, low code risk

#### PR-A1 — ASIC entity registry + ingest wiring _(ship first, no deps)_

**Goal:** make ASIC-listed _entities_ (names + aliases + domains) queryable across surfaces, not just domains-in-`scam_urls`.
**Why a new table (not `scam_entities`):** `scam_entities.entity_type` has no company/name type, and the ASIC list is a regulator-confirmed registry with its own add/remove lifecycle.

**Migration `v244_asic_investor_alerts`:**

- `asic_investor_alerts`: `id`, `entity_name`, `entity_name_normalized` (reuse `brand_normalize()` semantics), `aliases TEXT[]`, `domains TEXT[]` (normalized), `alert_type`, `asic_url`, `first_seen`, `last_seen`, `snapshot_date`, `is_active`, `raw JSONB`, `created_at`. Unique on `entity_name_normalized`. GIN on `domains`, btree on normalized name, partial on `is_active`.
- **RLS in-migration:** public `SELECT` (regulator open data) — simplest for the "is this listed?" consumer lookup.
- RPC `lookup_asic_investor_alert(p_query TEXT)`: normalize + match on name / alias membership / domain membership; `SECURITY INVOKER`, `SET search_path = public, pg_catalog`, `#variable_conflict use_column`.

**Scraper (`pipeline/scrapers/asic_investor_alerts.py`):**

- Keep `bulk_upsert_urls` → `scam_urls` (URL Guard keeps working).
- Add `bulk_upsert_asic_alerts` (`common/db.py`) — chunked ≤5K, `SET LOCAL statement_timeout='300s'`, per-chunk try/except+commit (the `acnc_register.py` reference shape).
- `is_active` snapshot diff: present today → active/`last_seen=now`; absent N consecutive snapshots → deactivate via bounded chunked UPDATE.
- Confirm `asic_investor` is in the `health-digest` staleness thresholds.

**Tests:** `tests/test_asic_investor_alerts.py` (payload-shape tolerance, name/alias/domain extraction, is_active diff) + RPC smoke in `rpcs.smoke.test.ts`.

#### PR-A2 — ASIC cross-surface lookup _(deps: A1)_

- Shared helper `packages/scam-engine/src/asic-lookup.ts` → `checkAsicInvestorAlert(query)`, Redis-cached, injectable client.
- Wire into: web analyze (`/api/analyze`), extension (`/api/extension/analyze` name path — domains already covered via `scam_urls`), bots (`bot-core/analyze.ts` → formatters). Mobile inherits via `/api/analyze`.
- Flag `NEXT_PUBLIC_FF_ASIC_LOOKUP` (server-only, default OFF). Free lookup; `logCost` units-only.

#### PR-A3 — AFS-licence verification lookup _(deps: A2 helper shape; feasibility CONFIRMED 2026-07-21)_

**Goal:** "is this platform licensed?" — pair the ASIC-listed _negative_ signal with a _positive_ registry check.

- **ASIC AFS Licensee check — BUILD (confirmed feed).** data.gov.au CKAN dataset `asic-afs-licensee` — CSV/TSV/XLSX, updated **weekly (Thu)**, licence **CC BY 3.0 AU** (attribute "Source: ASIC"), no auth. Resolve the date-stamped file each run via `https://data.gov.au/data/api/3/action/package_show?id=asic-afs-licensee` → `resources[].url` (do NOT hardcode `afs_lic_YYYYMM.csv`). Schema keys: `AFS_LIC_NUM`, `AFS_LIC_NAME`, `AFS_LIC_ABN_ACN`, `AFS_LIC_START_DT`, `AFS_LIC_CONDITION`.
- **Shape:** this is a **scraper + table**, not an on-demand lookup — mirror PR-A1: a `pipeline/scrapers/asic_afs_licensee.py` (weekly) → `asic_afs_licences` table (migration) → `check_afs_licence(name|acn|licnum)` RPC → `packages/scam-engine/src/afs-licence.ts` helper wired into the same surfaces as PR-A2. Flag `NEXT_PUBLIC_FF_AFS_LICENCE_CHECK`. Free; `logCost` units-only.
- Sibling datasets available if useful later (same terms): `asic-credit-licensee`, `asic-afs-authorised-representative`.
- **AUSTRAC VASPR → BACKLOG (no feed).** DCE/VASPR register is a session-stateful JSF app (`online.austrac.gov.au`, 302→auth), per-row PDF only, no data.gov.au dataset. Do NOT build a scraper. Recorded in §4b.

#### PR-B1 — Checkout Guardrail (extension, dark) _(deps: B2 for good hits; buildable now)_

- **Trigger:** new content script `checkout-guard.content.ts` (`<all_urls>`, `document_idle`, `__CHECKOUT_GUARD_ENABLED__`) running existing `detectCommerce()`; fire on checkout-form signal.
- **Cheap client signals:** hostname; `xn--`; `lexicalMatch` vs watchlist (pure fn, bundle-safe); brand-text-present-but-domain-not-allowlisted; referrer = Google Shopping/Ads.
- **Fast server route** `apps/web/app/api/extension/analyze-checkout/route.ts`: `validateExtensionRequest` (per-install ECDSA, inherits rate buckets); `if (!featureFlags.checkoutGuard) 503`; signals = `lexicalMatch` + `scam_urls` lookup + `whois-cached` age band + additive score (**no APIVoid**). Return `{verdict, score, reasons[], deepCheckUrl→/shop-check}`.
- **UI:** reuse URL-Guard closed-shadow-DOM overlay (factor into `lib/warning-overlay.ts`); render _before_ submit.
- **Flags:** twin `WXT_CHECKOUT_GUARD` + `NEXT_PUBLIC_FF_CHECKOUT_GUARD` → `featureFlags.checkoutGuard` (both OFF).
- **CWS:** if the build doesn't already have `<all_urls>`, sensitive-permission re-review (1–3 days) — sequence the manifest bump; document in `docs/ops/`.
- **Verdict logging:** prefer reusing `verdict_feedback`; only add `checkout_guard_verdicts` (RLS in-migration) if the shape can't carry it.
- **Tests:** vitest + jsdom lookalike-checkout fixture (mirror #789 FB-fixture pattern).

#### PR-B2 — Seed brands into the watchlist _(no deps; parallel with B1)_

- Add entries to `packages/shopfront-glue/src/au-brand-watchlist.ts`: The Ordinary (`theordinary.com`,`niod.com`,`deciem.com`), Naturium (`naturium.com`) + a first tranche of high-traffic AU DTC/retail brands.
- **Migration `v245_seed_known_brands_beauty_aliases`:** seed same brands into `known_brands` + `brand_aliases` (new migration; never edit v174/v195). RLS already present on both.

#### PR-C1 — Two education posts _(Q5 only for naming; ship generic)_

- Blog is DB-backed (`blog_posts`) — add via seed script or `/admin/blog`. Set `search_vector`, `blog_categories`.
- Post 1 "Shopping safely from Google results"; Post 2 "Fake AI copytrading & withdrawal-block scams". Report links (Scamwatch/ReportCyber/ASIC). Generic language until Q5 + threat-intel validation.

### Stage 2 — this quarter

- **PR-D1 — crypto-wallet reputation + regulator-warning signals (net-new, blocked Q4):** flag-gated source `wallet-reputation.ts` + `crypto_wallet` branch in `entity-enrichment.ts` + migration `v246` crypto signal in `compute_entity_risk_score`; `logCost` + `feature_brakes('wallet_reputation')` + cap. **Also fold in international regulator warnings** as additional independently-flag-gated reputation inputs (the offshore analogue to ASIC). Feasibility CONFIRMED 2026-07-21:
- **FMA (NZ) warnings — BUILD.** Undocumented but live CSV endpoint `https://www.fma.govt.nz/library/warnings-and-alerts/downloadWarnings/?DateFrom=DD/MM/YYYY&DateTo=DD/MM/YYYY` (both date params required; use a wide range for a full pull). Columns: `Entity Name`, `Date`, `Content` (free-text block w/ `Company:`/`City:`/`FSPR:`). No auth; keep the scraper defensive (UI endpoint, may change). Shape = scraper → `regulator_warnings` table (source-tagged) → reputation signal.
- **IOSCO I-SCAN — BUILD, but gated on a founder action.** Real REST API `https://api.iosco.org/v1/i-scan/warnings` (JSON), but **requires an API key requested by email to `api@iosco.org`** (Bearer auth, 10 req/s). → **Founder gate Q6: email IOSCO for the key.** Until the key exists, code the ingester behind `IOSCO_API_KEY` + a flag and leave dark.
- Broker-review sentiment is explicitly **out of scope → BACKLOG** (fragile scraping, low marginal value).
- **PR-D2 — ASIC as onward destination (deps A1/A2):** migration `v247` adds `asic` to `onward_destination` enum + new `get_onward_destinations` version (don't edit v119); worker `onward-asic.ts`; ASIC constants in `destinations.ts`; `FIXED_DESTINATION_KEYS` entry.
- **PR-E0 — Evolve the (already-unified) web checker input.**
  - **REALITY CHECK (investigated 2026-07-21):** the live homepage checker `apps/web/components/ScamChecker.tsx` is **already a single unified box** — text, URLs, image (via the attach drawer), and QR all share ONE textarea posting to `/api/analyze` (no `mode` sent for text/URL). **There are no Text/URL/Image tabs in the codebase** — the strings "Attach file" and that tab triad appear nowhere; the tabbed screenshot is a **mockup, not the live product.** Placeholder already reads "Paste the suspicious message, email, or URL here…" (`ScamChecker.tsx:600`). **Decision: keep the unified box; do NOT adopt the tabbed design** — it would re-split what's already unified and force users to self-classify (a scam SMS is text _and_ a link).
  - So PR-E0 is two small evolutions of the existing box, not a merge:
  - **(a) Communicate breadth (front-end only, trivial).** Add example chips under the box ("message · email · website · shop · TikTok link") + a "looks like a link — we'll check the destination" hint reusing the existing `deriveCommerceUrl` primitive (`ScamChecker.tsx:54`). No backend change. Ship alongside PR-C1/PR-E1.
  - **(b) Bare-URL cost fast-path (OPTIONAL backend win).** **Gate resolved:** a bare URL on `/api/analyze` currently pays for Claude Haiku on every cache-miss (`route.ts:286-295`) — `mode` never skips the LLM. So merging was never a cost _risk_. The opposite is true: the extension `url-check` route (`apps/web/app/api/extension/url-check/route.ts`) has a **Claude-free** path (`scam_urls` lookup + `checkURLReputation` Safe Browsing/VirusTotal). Opportunity: when the web box input is **URL-only** (no surrounding message), detect server-side and route to that cheap path, skipping Haiku → faster + cheaper URL checks. Scope tightly: only when input is a bare URL; anything with surrounding text still needs Claude (context matters). Ship only if `cost_telemetry` shows meaningful Haiku spend on URL-only analyze inputs — nice-to-have, not required for the shop/copytrading features.
- **PR-E1 — copytrading bots branch + TikTok UX:** `scamType`-keyed warning across 4 formatters + ASIC line; the "Check a TikTok link/screenshot" flow rides the unified box from PR-E0 (no new tab); optional `url` mode on `WebAnalyzeInputSchema` only if the bare-URL fast-path needs an explicit hint; routing block (TikTok in-app report + ASIC + Scamwatch/ReportCyber).
- **PR-F1 — Web Risk API for paid/B2B tiers (blocked Q1):** tier-aware selection in `checkURLReputation` + `logCost` + cap.

### Stage 3 — non-code / B2B

- TikTok Trusted Flagger + NASC partnership applications (Q3).
- Brand-impersonation monitoring as paid B2B on `monitored_brands` (v207) + clone-watch + watchlist (Q2).
- SPF "detect–disrupt" compliance module ahead of 31 Mar 2027 (aligns with monetisation wayfinder SPF wall).

---

## 4. Cross-cutting DoD (every PR)

- [ ] Fresh branch off `main`; `git branch --show-current` verified; explicit `git add`.
- [ ] Migrations idempotent, sequenced from **v244**, RLS in the same migration.
- [ ] `get_advisors` (security + performance): **no new ERRORs** vs. 2026-07-21 INFO-only baseline.
- [ ] `pnpm turbo typecheck` green (+ `pytest` if Python touched).
- [ ] Flag-gated OFF (twin `WXT_*` + `NEXT_PUBLIC_FF_*` where extension + server).
- [ ] Extension routes use `validateExtensionRequest` + inherit rate buckets.
- [ ] `logCost()` on paid-API paths; `feature_brakes` where spend; new Inngest fn → `docs/inngest-brakes.md`.
- [ ] CWS re-review sequenced if host perms widen (PR-B1).
- [ ] Vercel preview green before squash-merge; migrations listed in PR body.
- [ ] ROADMAP/BACKLOG updated.

---

## 4b. Explicitly deferred (recorded, not dropped)

- **Family-protection framing (research §3.4).** Tables (`family_groups`/`family_members`/`family_activity_log`/`device_push_tokens`) **and** UI (`app/app/family/page.tsx`, `api/family/*`) already exist. A "check before you invest / before you recommend to a relative" flow + affinity alerts via `device_push_tokens` is a **separate initiative** — deliberately NOT coupled to Stage 1/2 so it doesn't block the ASIC ingester. **Revisit after Stage 2.** → BACKLOG.
- **Broker-review sentiment signal.** Fragile (scraping review sites), low marginal value vs. ASIC/AFS/VASPR/FMA/IOSCO. → BACKLOG.
- **AUSTRAC VASPR check → BACKLOG (confirmed 2026-07-21).** No machine-readable feed; DCE register is a session-stateful JSF app with per-row PDF export only. Revisit only if AUSTRAC publishes a dataset.
- **Feasibility resolved (2026-07-21):** ASIC AFS-licence = BUILD (data.gov.au CSV), FMA = BUILD (CSV endpoint), IOSCO = BUILD after founder emails `api@iosco.org` for a key (Q6), AUSTRAC = BACKLOG.

## 5. Risks & notes

- **`.au` domain-age is null** from free WHOIS (auDA withholds) — never treat "unknown age" as "safe" for `.au`; lean on lexical + `scam_urls` + `au-registrant.ts` ABN checks.
- **ASIC JSON shape is undocumented** — scraper already tolerates list/`{records}`/`{data}`; A1 entity extraction must be equally defensive + fixture-tested.
- **Latency budget** on `analyze-checkout` is the point — lexical + one DB lookup + cached WHOIS only; never APIVoid/Claude inline.
- **Don't let PR-B1 become a second clone-watch.** Clone-watch = proactive NRD sweep; guardrail = reactive at-checkout. Shared: `lexicalMatch` + watchlist + scoring. Nothing else.
- **Verdict-logging:** reuse `verdict_feedback` if possible; avoid adding another policy-less table to the advisor backlog.
