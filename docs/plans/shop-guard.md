# Shop Guard — Implementation Plan

## 1. Summary

Shop Guard is Ask Arthur's verdict-and-pillar verification engine for **suspicious online retailers**, folded into the planned URL Guard rather than shipping as a free-standing surface. It produces a **Shop Check Result** — a new multi-pillar result type modelled on Charity Check Result — built from a fan-out of register and reputation Pillars (Safe Browsing, Netcraft, infrastructure cluster, domain age, ABR/AU business presence, content heuristic, historical Scam Reports, DOM heuristic). The result returns the canonical four-level **Verdict** plus a composite 0–100 risk score, per-Pillar payloads, and a coverage map. Surfaces: web (in the existing analyze drawer on `/` via `/api/analyze`'s `shopping_check` enrichment branch), extension (URL Guard content script + popup detail), mobile (Expo share-sheet hand-off to `/api/analyze`).

**Shop Guard does NOT:** run the Unified Scan Result audit pipeline (it is not `/site-audit` or `/audit`); replace external blocklists (it consumes Safe Browsing + Netcraft, doesn't seed them); crawl the open web for fresh shops (it evaluates user-supplied URLs on demand and caches); write `verified_scams` directly (verified status comes from the existing analyze pipeline when a HIGH_RISK Shop Check Result is also persisted as a Scam Report); or score legitimate AU SMB retailers as "unknown = bad" (graceful degradation rule prevents an empty register hit from cratering the verdict).

## 2. Domain model

### Decision: introduce a new **Shop Check Result** type

The Charity Check Result shape applies almost 1:1 — multi-pillar fan-out, per-Pillar `{ id, score, confidence, available, reason?, detail? }`, coverage map, composite score, official-URL slot, plain-English explanation. Reusing Analysis Result with a `shopping_scam` enrichment field would force the Pillar-shaped data into a free-form `enrichment` blob, breaking the "two adapters mean a real seam" pattern in ADR-0002 (a third pillar-typed result type makes the extraction-to-shared-module case much stronger — call that out in the ADR consequence section).

**Shop Check Result** (proposed shape, mirrors `CharityCheckResult`):

```ts
interface ShopCheckResult {
  verdict: Verdict;                          // SAFE | UNCERTAIN | SUSPICIOUS | HIGH_RISK
  composite_score: number;                   // 0..100, higher = more risk
  pillars: Record<ShopPillarId, ShopPillarResult>;
  coverage: ShopCoverage;                    // per-Pillar live/degraded/disabled
  providers_used: string[];
  explanation: string;
  official_business_record: { abn?: string; entity_name?: string } | null;
  generated_at: string;
  request_id: string;
}
```

**Add a `Shop Check Result` entry to `CONTEXT.md`** alongside Charity Check Result, with the same independence note ("does not itself become a Scam Report unless the user separately submits the underlying claim; its Pillars are not Scam Entities").

### Pillars (id namespace per ADR-0002 — local to Shop Guard, not globally unique)

| Pillar id | Source | Weight (initial) | Stage |
|---|---|---|---|
| `safe_browsing` | Google Safe Browsing (already wired in `/api/analyze` step 7) | 0.15 | S1 |
| `netcraft` | Netcraft Threat Intel API | 0.20 | S2 |
| `infrastructure_cluster` | IP/ASN/registrar/cert clustering vs known Scam Entities | 0.15 | S2 |
| `domain_age` | WHOIS/RDAP (≤30d → high risk) | 0.10 | S1 |
| `abr_au` | ABR ABN Lookup (reuses charity-check's ABR adapter) | 0.10 | S1 |
| `content_heuristic` | Server-side HTML fetch + heuristic markers (heavy discount % regex, fake-trust-badge images, broken legal pages) | 0.10 | S2 |
| `historical_reports` | `scam_entities` JOIN on URL/domain — prior Scam Reports | 0.10 | S1 |
| `dom_heuristic` | Extension content-script only — schema.org Product/Offer + Shopify/WooCommerce DOM markers (additive) | 0.10 | S3 |

Pillar scores are **0..100, higher = more risk** (matches Phone Footprint and Charity Check). Per ADR-0002, when a Pillar reports `available: false`, the scorer redistributes its weight pro-rata across available Pillars. `dom_heuristic` is only emitted from extension content-script payloads — server-only callers see it permanently `unavailable` with `reason: "no_dom_payload"`, weight redistributes.

**Hard floor rule:** if `safe_browsing.score ≥ 80` OR `historical_reports.score ≥ 80`, floor verdict to `HIGH_RISK` (matches the analyze pipeline's existing Safe Browsing escalation in data-flows.md §1 step 9).

## 3. Surfaces — answers the user's three questions

### Web: in the existing analyze drawer, NOT a standalone `/shop-check` page

**Recommendation:** Shop Guard is an **enrichment branch off `/api/analyze`**, surfaced inline in the analyze drawer on `/` — no `/shop-check` page.

**Trade-off articulated against Charity Check's asymmetric standalone page:**
- Charity Check ships standalone because it has a **specific named-entity claim** the user is actively researching ("is this charity legit?") — pre-donation intent. The page hosts an autocomplete and is bookmarkable.
- Shop Guard intercepts a **reactive moment of doubt** ("this shop URL came up in an ad / DM / search result, is it real?"). The user is already in the analyze flow; making them context-switch to a separate page friction-loses the conversion. The research brief argues for in-drawer for exactly this reason.
- The Verdict UI in the analyze drawer already renders Pillar-shaped data (Phone Footprint enrichment). Shop Check Result adds a second Pillar block beneath it when `inputDetector` classifies the input as `url` AND `commerce_signal: true`.
- Operational benefit: one rate limit, one Idempotency-Key path, one Redis cache key, one billing path. The cost-brake (`SHOP_GUARD_CAP_USD`) checks at the start of the enrichment branch.

**Drawer clarification.** The "traditional drawer" in this repo is `apps/web/components/ScreenshotDrawer.tsx` — the vaul slide-up that hosts the **input selector** (photo/QR/clipboard). The analyze **results** render inline in the `ResultCard`. Shop Guard's Pillar block lives in the results card, not the drawer; the drawer remains for input only.

`/api/analyze` continues to be the single entry point. Inside, when input-detector flags the URL as a commerce page (cheap heuristic — TLD/path/known-platform hints; full DOM signals only available from extension), the server branches into the Shop Guard fan-out *in parallel* with the existing Claude + URL reputation phases.

### Extension: URL Guard content-script overlay + popup detail (both)

URL Guard is **already shipped** in the extension (gated by `WXT_URL_GUARD` build flag + `NEXT_PUBLIC_FF_URL_GUARD` server flag). Shop Guard extends it; it does not introduce a parallel content script.

**Detector wiring (content-script, only on commerce-looking pages):**
- `schema.org` Product / Offer JSON-LD parsing (cheap, high signal — most Shopify and BigCommerce stores emit it).
- `<form>` with payment fields (`autocomplete="cc-*"`, Stripe iframe origin, PayPal SDK script tag).
- Common platform DOM markers: `body.Shopify-section`, `meta[name="generator"][content*="WooCommerce"]`, `meta[name="generator"][content*="Shopify"]`, `[data-cb-shop]` (BigCommerce).
- Two-of-three rule before activation (avoids firing on every page that has a "buy now" link in a footer).

**Surface split:**
- **Content-script overlay (URL Guard branch):** the existing `url-guard.content.ts` listens for `SHOW_PHISHING_WARNING`; add a `SHOW_SHOP_GUARD_VERDICT` message (separate handler, same shadow-DOM host pattern) that renders a soft, dismissible Pillar summary inline for SUSPICIOUS, and a hard interstitial for HIGH_RISK. SAFE / UNCERTAIN don't overlay — they only colour the popup badge.
- **Popup detail:** every navigation produces a popup state (Verdict badge + per-Pillar expandable list + "View on web" link to the verdict page). This is the discoverable surface for SAFE / UNCERTAIN where an overlay would be annoying.

**MV3 + host-permission staging (matches BACKLOG.md URL Guard item):**

| Stage | Host permission | Surface | CWS re-review |
|---|---|---|---|
| 1 | `activeTab` only (user clicks toolbar icon) | Popup detail | No (existing perms) |
| 2 | `optional_host_permissions: ["<all_urls>"]` — user opts in once | Popup detail + content-script DOM heuristic when granted | One-time opt-in dialog, no re-review |
| 3 | `host_permissions: ["<all_urls>"]` (manifest bump v1.0.2) | Auto-overlay on navigation | **Sensitive-permission CWS re-review (1–3 days)** — gates Shop Guard's autonomous detection. Tracked as a risk below. |

Request signing reuses the existing `apps/extension/src/lib/sign.ts` (ECDSA P-256 from `extension_installs`). No new identity work.

### Mobile: share-sheet hand-off only (no Expo-native pillar runner)

- iOS Share Sheet / Android Share intent → URL captured by `apps/mobile/lib/share-handler.ts` → POST to `/api/analyze` with `{ text: "<url>" }` plus `X-Ask-Arthur-Surface: mobile-share` header.
- Server renders the Shop Check Result inline in the analyze response.
- Mobile drawer (existing Expo verdict UI) renders the Pillar block the same way as web (shared component contract via `@askarthur/types` Zod schema for the wire shape).
- No native iOS/Android Pillar code. No on-device DOM heuristic (mobile has no page DOM context — `dom_heuristic` is permanently `unavailable` for mobile callers; coverage map renders `disabled`, scorer redistributes weight).

## 4. Backend architecture

### Route shape: `shopping_check` enrichment branch off `/api/analyze` (NOT a new route)

Justification: the deletion test. A new `/api/shop-check` route would duplicate IP extraction, rate-limit, Idempotency-Key plumbing, Zod validation, image-upload guard, geolocation, cost-telemetry helper instantiation, and the Inngest fan-out emit. Deleting that route module and moving the orchestrator call inline into `/api/analyze` step 8 (parallel with `analyzeWithClaude` + URL reputation) leaves no orphan logic — every line either ran already or moves into `runShopCheck()`. Per CLAUDE.md "deletion test", inline.

### Table strategy: new `shop_checks` table (NOT `scam_reports.enrichment` JSONB)

Rationale (database.md §"Hot tables" + ADR-0005):
- `scam_reports` is already `[hot ⚠]` and runs partial HNSW. Stuffing a third optional structured payload into its `enrichment` JSONB would force every read of any Scam Report to deserialize a Shop Check Result it doesn't need, and would mix retention timelines (Scam Reports retain 180d → archive; Shop Check Results have a 90d TTL for register-freshness reasons).
- A dedicated `shop_checks` table can have its **own retention** (90d) and a write-frequent profile distinct from `scam_reports`. It will be hot — every commerce URL the analyze pipeline sees writes one row.

```sql
-- migration v135 (reserved)
CREATE TABLE IF NOT EXISTS public.shop_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  url_hash        bytea NOT NULL,            -- sha256(normalized_url)
  url_normalized  text NOT NULL,             -- public domain + path; query-stripped
  verdict         verdict_enum NOT NULL,     -- reuses existing enum
  composite_score smallint NOT NULL,
  pillars         jsonb NOT NULL,            -- ShopPillarResult map
  coverage        jsonb NOT NULL,
  request_id      text,
  source_surface  text,                      -- 'web' | 'extension' | 'mobile-share' | 'bot'
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  ttl_expires_at  timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE UNIQUE INDEX shop_checks_idempotency_uk
  ON public.shop_checks (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX shop_checks_url_hash_evaluated
  ON public.shop_checks (url_hash, evaluated_at DESC);
CREATE INDEX shop_checks_ttl_brin
  ON public.shop_checks USING BRIN (ttl_expires_at);
```

**Hot-write rules applied:**
- `[hot ⚠]` flag added in database.md when the table ships.
- **No HNSW or large GIN on this table.** If we want semantic match against historical shop scams later (Stage 3+), embeddings go on a 1:1 sibling `shop_check_embeddings` (the `acnc_charity_embeddings` v121 pattern). Recorded for ADR-0005 compliance.
- Retention cron chunks at ≤5K rows/iteration with `statement_timeout='300s'` (per CLAUDE.md Critical Rules; modelled on `archive_secondary_tables_batch`).
- All writes through a `SECURITY DEFINER` RPC `upsert_shop_check(...)` with `ON CONFLICT (idempotency_key) DO UPDATE` (matches the `create_scam_report` idempotency backstop).

### New paid APIs

| API | Env var | Cost-telemetry tag | Cache |
|---|---|---|---|
| Netcraft Threat Intel | `NETCRAFT_API_KEY` | `feature='shop-guard'`, `provider='netcraft'`, `operation='threat-intel'` | Upstash Redis 24h on url_hash + Bloom filter for "definitely not in Netcraft DB" repeat-URL fast-path |
| ABR ABN Lookup | `ABR_GUID` (already exists for Charity Check — reuse) | `feature='shop-guard'`, `provider='abr'`, `operation='abn-lookup'` | Redis 7d (ABR data slow-changing) |
| WHOIS / RDAP | `RDAP_PROVIDER_KEY` (optional; falls back to public RDAP) | `provider='rdap'` | Redis 30d |

**Cost-brake:** `SHOP_GUARD_CAP_USD=5` (matches `CHARITY_CHECK_CAP_USD` shape). Checked at the start of the Shop Guard branch in `/api/analyze` and at the start of each paid-pillar adapter inside the orchestrator. Brake reads `feature_brakes.shop_guard`; on cap-hit, emit a `coverage: degraded` Shop Check Result with paid pillars unavailable + sets `paused_until = now() + interval '24 hours'`.

### Inngest fan-out (heavy pillars only)

Following the `FF_ANALYZE_INNGEST_WEB` pattern. Cheap pillars (`safe_browsing`, `domain_age`, `historical_reports`, `abr_au`) run **inline** in the route's 5s budget (mirrors the Charity Check orchestrator). Heavy pillars fan out durably:

- `shop-guard-netcraft` — calls Netcraft Threat Intel, writes back to `shop_checks` via partial UPDATE
- `shop-guard-infrastructure-cluster` — runs IP/ASN cluster join against `scam_entities`, may itself enqueue follow-up entity enrichment
- `shop-guard-content-heuristic` — fetches HTML server-side (cf-fetch-worker style; 5s timeout, 2MB cap) and runs heuristic regex

These consumers subscribe to `shop.check.completed.v1` (event id = requestId) with function-level `idempotency: "event.data.requestId"` (three-layer idempotency, same as analyze pipeline).

### Cron

| Cron route | Schedule | Purpose |
|---|---|---|
| `/api/cron/shop-checks-retention` | `45 3 * * *` | Chunked DELETE `shop_checks` where `ttl_expires_at < now()` — ≤5K rows/iter, `statement_timeout='300s'` |
| `/api/cron/shop-checks-revalidate-high-risk` | `0 5 * * 0` (weekly, Sun) | Re-run pillars on HIGH_RISK URLs older than 7d — checks for takedown / re-evaluation; emits Inngest events, doesn't block. Cost-brake gated. |

Both crons are documented in `docs/system-map/background-workers.md` when shipped.

### Idempotency (three-layer, matches analyze pipeline)

1. HTTP `Idempotency-Key` header → `X-Request-Id` echo (existing analyze plumbing).
2. Inngest event id = requestId (24h dedup).
3. Postgres `shop_checks.idempotency_key` partial UNIQUE + `upsert_shop_check` RPC `ON CONFLICT … DO UPDATE`.

### Auth-dependent paths

Shop Guard surfaces are public (open + IP rate-limited). No Supabase session is required — but the route handler's existing `Promise.race` 5s wrap around any `getUser()` call (used for tier-based brake exemptions) stays as-is. No new auth-dependent code path is introduced.

## 5. Feature flags & cost brake

| Flag | Type | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_FF_SHOP_GUARD` | Consumer | OFF | Enables Shop Check Result block in the analyze drawer (web + mobile) and popup badge in the extension |
| `FF_SHOP_GUARD_BACKEND` | Server-only | OFF | Enables the `shopping_check` enrichment branch in `/api/analyze`; when OFF, the route skips Shop Guard entirely (no DB write, no paid-API call) |
| `WXT_SHOP_GUARD` | Extension build-time | OFF | Bundles Shop Guard content-script + popup wiring into the extension build |
| `SHOP_GUARD_CAP_USD` | Cost brake | `5` | `cost_telemetry WHERE feature='shop-guard'` daily cap |

**Pre-flip-on checklist** (per CLAUDE.md "Always Do"): re-run `mcp__supabase__get_advisors` + Disk IO query before flipping `NEXT_PUBLIC_FF_SHOP_GUARD` from OFF to ON.

## 6. PR sequence (8 PRs, dependency-ordered)

Mirrors the F1–F11 Charity-Check ladder.

### PR 1 — `shop-guard/types-and-schema` (≤300 LOC)
- **Scope:** Add `ShopCheckResult`, `ShopPillarResult`, `ShopCoverage`, `ShopPillarId` to a new `packages/shop-guard/src/types.ts`. Add Zod schema to `@askarthur/types` for the wire shape. Add `NEXT_PUBLIC_FF_SHOP_GUARD`, `FF_SHOP_GUARD_BACKEND`, `SHOP_GUARD_CAP_USD` to `packages/utils/src/feature-flags.ts` (default OFF). Add `Shop Check Result` to CONTEXT.md. No runtime behaviour change.
- **Exit:** Build green; `pnpm turbo typecheck` clean; flags appear in `docs/system-map/feature-flags.md`.
- **Depends on:** none.

### PR 2 — `shop-guard/migration-v135-shop-checks-table` (≤200 LOC SQL)
- **Scope:** Migration v135: `shop_checks` table + indexes + RLS (service-role write, public read of own request_id only — pattern from `phone_footprints`) + `upsert_shop_check(...)` RPC + `cleanup_expired_shop_checks(batch_size, days)` chunked retention RPC (≤5K rows, `statement_timeout='300s'`).
- **Exit:** Applied via `mcp__supabase__apply_migration`; advisors clean; rpcs.smoke test green; table appears in `docs/system-map/database.md` flagged `[hot ⚠]`.
- **Depends on:** PR 1.

### PR 3 — `shop-guard/engine-cheap-pillars` (≤500 LOC)
- **Scope:** Create `packages/shop-guard/` package mirroring `packages/charity-check/` layout (`provider-contract.ts`, `orchestrator.ts`, `scorer.ts`, `providers/{safe-browsing,domain-age,historical-reports,abr-au}.ts`). Reuses ABR provider shape from charity-check (factor the AU-specific call into a shared helper if and only if two callers actually need it — per the deletion test, inline first). 5s overall budget via `withTimeout`. No new ADR (this is the third pillar-typed engine; flag in PR description that the shared-module case is now ripe and should be considered after PR 8).
- **Exit:** Unit tests pass for each Pillar; orchestrator unit test exercises graceful degradation + hard floors; no Inngest dependency yet.
- **Depends on:** PR 1.

### PR 4 — `shop-guard/route-integration-cheap-path` (≤400 LOC)
- **Scope:** Wire `runShopCheck()` into `/api/analyze` parallel branch when (a) input-detector classifies as `url`, (b) URL passes cheap commerce-page heuristic (TLD + known-platform hint), (c) `FF_SHOP_GUARD_BACKEND=true`. Persist via `upsert_shop_check` RPC. Cost-brake at branch entry + per-paid-pillar. `cost_telemetry` rows tagged `feature='shop-guard'`.
- **Exit:** E2E test through `/api/analyze` returns a populated `shop_check` block; `shop_checks` row written; brake fires when cap exceeded. Flag OFF in prod.
- **Depends on:** PR 2, PR 3.

### PR 5 — `shop-guard/inngest-heavy-pillars` (≤500 LOC)
- **Scope:** Add `shop-guard-netcraft`, `shop-guard-infrastructure-cluster`, `shop-guard-content-heuristic` Inngest functions in `packages/scam-engine/inngest/`. Emit `shop.check.completed.v1` from the route after the cheap-path response. Each consumer writes back to `shop_checks` via partial UPDATE through a `update_shop_check_pillar(...)` RPC (idempotent on `(id, pillar_id)`).
- **Exit:** Heavy-pillar payloads land in `shop_checks.pillars` within 30s of route response; per-function header comments document expected duration to satisfy pg-watchdog runbook.
- **Depends on:** PR 4.

### PR 6 — `shop-guard/web-drawer-ui` (≤400 LOC)
- **Scope:** Render Shop Check Result block in the existing analyze results card on `/`. Pillar accordion + Verdict pill + coverage hints + "Why this verdict" expander. Reuses `charityResultToResultCard` patterns where they translate. Gated on `NEXT_PUBLIC_FF_SHOP_GUARD`.
- **Exit:** Storybook snapshots; Playwright drawer test for SAFE / SUSPICIOUS / HIGH_RISK / UNCERTAIN; design-system tokens only.
- **Depends on:** PR 4.

### PR 7 — `shop-guard/extension-popup-and-overlay` (≤500 LOC)
- **Scope:** New popup state, new `SHOW_SHOP_GUARD_VERDICT` message handler in `url-guard.content.ts`, commerce-page DOM detector (`apps/extension/src/lib/commerce-detector.ts`). Stage-1 ships with `activeTab` only — overlay activates on user click. `WXT_SHOP_GUARD` build-time flag.
- **Exit:** Tested under stage-1 perms in CWS unlisted draft channel; popup renders Pillar block; no CWS re-review needed (still `activeTab`).
- **Depends on:** PR 4.

### PR 8 — `shop-guard/crons-retention-and-revalidate` (≤300 LOC)
- **Scope:** `/api/cron/shop-checks-retention` (nightly) + `/api/cron/shop-checks-revalidate-high-risk` (weekly Sun). Chunked patterns matching `archive_secondary_tables_batch`. Documented in `docs/system-map/background-workers.md`.
- **Exit:** Crons run in preview; row counts logged per chunk; pg-stuck-query-watchdog stays quiet.
- **Depends on:** PR 4.

**Stretch / Stage-3 follow-ups (not in v0.1):**
- Optional PR 9: extension stage-3 `<all_urls>` manifest bump (sensitive CWS re-review window).
- Optional PR 10: extract `packages/multi-pillar-engine/` from charity-check + shop-guard + phone-footprint (the ADR-0002 follow-up — now three callers).

## 7. Rollout & success metrics

### Stage thresholds (mirrors research brief; bracketed because AV-Comparatives publishes ranges, not exact rates)

| Stage | Detection rate target (bracketed) | False-positive cap (AU SMB corpus) | Surfaces enabled |
|---|---|---|---|
| Stage 1 | ≥60% on adversarial corpus | ≤2% | Web in-drawer (PRs 4+6); flag preview-only; cap A$5/day |
| Stage 2 | ≥80% | ≤2% | + extension popup (PR 7); extension stage-1 perms; flag ON for 10% rollout |
| Stage 3 | ≥85% | ≤2% | + extension stage-3 overlay + mobile share; flag ON 100%; cap raised to A$15/day |

**Hard stop:** if FP against the AU small-retailer corpus exceeds 2% at any stage, flag flips OFF, advisors and Disk IO checked, no progression.

### AU small-retailer corpus

- Lives at `apps/web/__fixtures__/shop-guard/au-small-retailer-corpus.json` (≥500 entries).
- Sources: ACNC-adjacent (sole-trader sellers), ASIC SMB register sample, AusPost partner directory, Shopify "made in Australia" curated list, manually-vetted Etsy AU sellers. Each entry: `{ url, abn, registered_name, expected_verdict: "SAFE" }`.
- Adversarial corpus at `apps/web/__fixtures__/shop-guard/known-scam-shops.json` — sourced from Scamwatch HTML scrape (already running via `pipeline/scrapers/scamwatch_alerts.py`) filtered by `category='online_shopping'`.
- Both corpora are inputs to a CI promptfoo-style eval that runs on PRs touching `packages/shop-guard/` (matches existing `promptfoo` GH Action gated on file filter).

### Telemetry

- `cost_telemetry` rows per pillar per call. Daily rollup contributes to `cost_telemetry_daily_rollup` MV.
- New row in `feature_brakes`: `shop_guard` (cap A$5).
- `/admin/costs` dashboard auto-picks up the new feature tag.

## 8. Risks & open questions

1. **Legal liability for false positives against legit small AU shops.** A wrongly-flagged HIGH_RISK overlay on a real retailer is defamation-adjacent. Mitigations: (a) conservative weights — no single pillar can drive HIGH_RISK alone except `safe_browsing` or `historical_reports` (both authoritative); (b) per-domain appeal path in admin; (c) the AU SMB FP corpus is a hard CI gate. Open: do we need a "verified retailer" allow-list (whitelisted ABNs that downgrade verdict)? Probably yes for Stage 3.

2. **Netcraft contract cost.** Netcraft Threat Intel is per-query metered, no public price; could be $0.05–$0.50/lookup at low volume. With the A$5/day cap and ~$0.20/lookup median, that's 25 lookups/day before paused. Open: is the cap realistic for Stage 2 (10% rollout)? Need a Netcraft pricing call before PR 5.

3. **ABR rate limits.** ABR ABN Lookup is free but rate-limited (~5 req/sec per GUID). Charity Check already consumes some quota. Mitigations: 7d Redis cache + per-domain dedup. Open: do we need a second ABR GUID for Shop Guard, or share the existing one and accept some throttling at peak?

4. **Chrome Web Store re-review on broader host permissions.** Stage-3 needs `<all_urls>` host permission (already flagged in BACKLOG.md URL Guard item). **1–3 day re-review** with re-rejection risk. Mitigation: stage-1 and stage-2 use `activeTab` + `optional_host_permissions` to ship value without the re-review. Stage-3 ships as a separate v1.0.2 release.

5. **Image / DOM-hash IP rights.** If Stage-3 reverse-image-hash detection (research-brief stretch) crawls product images for clone detection, we may incur DMCA / copyright exposure when storing hashes. Open: legal review needed; probably defer reverse-image to Stage 4.

6. **ScamAdviser opt-in.** Research brief mentions ScamAdviser as a potential pillar source. Their TOS prohibits unattributed re-display. Open: is opt-in attribution acceptable in our UI, or do we keep them off the pillar list entirely? Default: omit until legal clears.

7. **Drift with Phone Footprint and Charity Check orchestrators.** ADR-0002 explicitly notes that with two implementations we duplicate rather than extract; with a third (Shop Guard), the right shared `multi-pillar` module is now discoverable. **Open:** do we extract during PR 3 or after PR 8? Recommendation: after PR 8, when all three are running and we can see the generic shape — extraction is its own PR with its own ADR.

8. **Shop Check Result vs Scam Report linkage.** Today a HIGH_RISK URL submitted via the analyze drawer creates a Scam Report via `create_scam_report`. If Shop Guard runs too, do we create one Scam Report linked to one Shop Check Result, or treat them independently? Open: probably link via a nullable `shop_check_id` FK on `scam_reports` (added in a later migration), so the Verdict on the Scam Report and the Verdict on the Shop Check Result can diverge over time (matches the analogous Phone Lookup Result pattern in CONTEXT.md).

9. **Cloaked-only-to-victims constraint.** Research brief: many fake shops cloak — desktop / no-Facebook-referrer requests get a 404. Implication: server-side `content_heuristic` HTML fetch will frequently return nothing useful; victim-submitted DOM (from the extension content script) is the only reliable signal for cloaked shops. The plan accepts this by treating `dom_heuristic` as additive-only and never gating verdict on `content_heuristic`.

10. **/audit (Unified Scan Result) grade conflation.** Research brief: fake shops typically score B+ on `/site-audit` because their TLS / headers / CSP are clean. Shop Check Result UI **must not** display the Unified Scan Result letter grade next to the Verdict — they answer different questions ("is this site technically well-built" vs "is this a real shop"). PR 6 explicitly excludes the audit grade from the Shop Guard card.
