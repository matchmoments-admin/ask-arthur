# Ask Arthur — Feature Backlog

Deferred features organized by platform. Items here are validated ideas that didn't make MVP but are worth building.

The "Audit Remediation Roadmap" below is the prioritized cross-cutting work
queue derived from the 2026-04-28 per-feature flow audit; everything beneath
it stays organized by platform/area.

---

## Investor Readiness — Sprint Shipped + Deferred (2026-05-25)

The 2026-05-25 audit (investor-readiness review) drove a one-day sprint that shipped four P0 security fixes + DB hygiene (PR #413, merged 2026-05-24) and a Claude Code harness pass (PR #414). Three followups and the SOC 2 path were explicitly deferred:

- **[#415](https://github.com/matchmoments-admin/ask-arthur/issues/415) — Deferred: SOC 2 Type I + Vanta/Sprinto kickoff.** Year 1 cost A$30–60K (platform A$5–15K + audit A$15–25K + pentest A$10–20K). Park until a named bank prospect requires it OR ARR justifies the burn. Full plan: `docs/pitch/certification-roadmap.md`.
- **[#416](https://github.com/matchmoments-admin/ask-arthur/issues/416) — Followup: Real device attestation.** `/api/mobile/attest` returns hard 501 today. Wire real Google Play Integrity + Apple App Attest verifiers when any mobile surface needs them. Currently nothing consumes a device token.
- **[#417](https://github.com/matchmoments-admin/ask-arthur/issues/417) — Followup: Phone Footprint fleet/org SKU ownership gate.** Consumer-SKU gate shipped; fleet path still trusts metadata `org_id`. Needed before any paying fleet customer signs up. Two design options (mapping table vs admin-membership check) listed in the issue.
- **[#418](https://github.com/matchmoments-admin/ask-arthur/issues/418) — Followup: Unit tests for the four hardened routes.** No tests existed pre-#413; retrofitting is `ready-for-agent`.

What shipped is locked in: `mcp__supabase__get_advisors security` returns 0 lints; prod home + `/api/analyze` + `/charity-check` + `/clone-watch` smoke tests green post-deploy (2026-05-24).

---

## Audit Remediation Roadmap (2026-04-28 flow audit)

The 2026-04-28 per-feature flow audit (~100 findings across 41 features)
produced this prioritized work queue. Full plan with verification matrix:
`~/.claude/plans/smooth-seeking-lerdorf.md`.

**Tier 0** (branch-check hook scope fix + `.sfdx` ignore) shipped as PR #41
(squash commit `e04fe51`). Items below are P0 → P4 by blast radius.

### P0 — Critical security (Tier 1; 5 separate PRs)

1. **Mobile device attestation hard-disable** — `apps/web/app/api/mobile/attest/route.ts:30-42` issues a server-signed `deviceToken` for _any_ input because both verifiers are TODOs. Flag is default-off, but flag-flip = auth bypass. Replace iOS/Android branches with `501 device_attestation_not_implemented`, make the 501 unconditional (ignores the FF), add a guard test. Track Apple `data.appattest.apple.com/v1/attestKey` + Google Play Integrity v1 verifiers as a separate "Device attestation hardening" backlog item.
2. **Stripe webhook ownership cross-check** — `apps/web/app/api/stripe/webhook/route.ts:138-209` feeds `metadata.api_key_id` into `syncTier` without proving the customer owns that key. `SELECT user_id FROM api_keys WHERE id = $1`, compare with `metadata.user_id` (and `auth.users.id` mapped from `stripe_customer_id` if a mapping table exists), reject mismatches with error log + no tier mutation. Same gate in `handleSubscriptionDeleted`. **Open decision:** verify whether a `user_stripe_customers` table exists before opening the PR; if not, add it via migration in the same PR.
3. **Org invite email binding** — `apps/web/app/api/org/invite/accept/route.ts:37-75` accepts an invitation if the caller is signed in and possesses the token, never compares `invitation.email` to `user.email`. Leaked token + any account = stolen role. Add case-insensitive email match → 403 on mismatch (don't leak invited email back). Bonus: 10/hour per-user invite-accept rate-limit (`R:askarthur:invite-accept:{userId}`).
4. **Slack `response_url` outbound SSRF guard** — Slack signature verifies inbound, but the response_url string is then fetched without a hostname allow-list. Wrap the outbound `fetch` (likely `apps/web/lib/bots/slack/sender.ts`) with `hostname === 'hooks.slack.com'` or `assertSafeURL`. Defense-in-depth — current threat requires `SLACK_SIGNING_SECRET` leak.
5. **Audit doc corrections** — record §35 image proxy and §13 Messenger verifier as **resolved** (both already implemented; audit was wrong on these — see `proxy-image/route.ts:3-7` and `webhooks/messenger/route.ts:53-69`). Add a "Remediation status" column for cross-cutting findings so future readers can diff against this audit. Doc-only.

### P1 — Reliability hardening (Tier 2; 4 PRs)

6. **HIBP client consolidation** — `packages/scam-engine/src/hibp.ts:checkHIBP` gains a `{ truncate?: boolean }` option (default `true`); the raw fetch in `apps/web/app/api/breach-check/route.ts` is replaced with the engine call. Route gets the existing 24h cache + 5s `AbortSignal.timeout` for free. Widen `HIBPResult` with optional `breaches: Array<{name, title, breachDate, dataClasses}>` populated only when `truncate=false`.
7. **Coalesce hot writes on `last_used_at` / `last_seen_at`** — `apiAuth.ts:175-178` (api_keys) and `extension/_lib/signature.ts:189` (extension_installs) update on every request. Wrap each with a Redis SETNX gate (`askarthur:touch:apikey:$id`, `ex 3600 nx`) so the UPDATE fires at most once per hour per key/install. Eliminates a row-contention hotspot at scale.
8. **ip-api timeout + Twilio async** — `geolocateIP` gains a 2s `AbortSignal.timeout` + Redis circuit breaker (5 consecutive failures → 60s cool). `/api/analyze` Twilio path moves out of the sync request via Inngest event `analyze.phone-intel.requested`; consumer updates `scam_reports.phone_intelligence` JSONB. Gated on `FF_ANALYZE_PHONE_INTEL_ASYNC` (canary pattern matching `FF_ANALYZE_INNGEST_WEB`). **Open decision:** confirm UX is acceptable (verdict response no longer carries phone-intel synchronously), or take the smaller 1.5s in-line timeout instead.
9. **`mark_stale_*` batched updates + bot queue retry alerting** — three RPCs (`mark_stale_urls`/`_ips`/`_wallets`) rewritten to loop in 5,000-row batches with COMMIT between, bounding WAL per batch. `bot_message_queue`'s `markFailed` path (in `packages/bot-core/src/queue.ts`) fires a throttled (1/hour/platform) Telegram admin alert when `retries+1 >= max_retries`. Reuse `sendAdminTelegramMessage` from `apps/web/lib/cost-telemetry.ts`.

### P2 — Architectural consolidation (Tier 3; 3 PRs)

10. **Verdict-merge module extraction** — new `packages/scam-engine/src/verdict.ts` exports `mergeVerdict(analysis, urlResults, injection)` and `isElevated(verdict)`. Migrate four call-sites: `apps/web/app/api/analyze/route.ts`, `apps/web/app/api/extension/analyze/route.ts`, `packages/bot-core/src/analyze.ts:30-46`, `apps/web/lib/mediaAnalysis.ts`. Lock the rules with a 10-test (verdict × URL × injection) matrix; verify byte-identical output via golden-file tests on recorded analyze inputs.
11. **Deepfake direction decision (open)** — overlaps with existing **"Deepfake detection wiring into `runMediaAnalysis`"** in the [Web App](#web-app) section. Today: `apps/web/lib/deepfakeDetection.ts:detectDeepfake` is exported but never imported in source; `FF:deepfakeDetection` is a no-op flag (and a foot-gun if anyone flips it expecting it to do something). Three options: **park-with-guardrail** (recommended; banner comment + warn on FF-on, no code wiring), **delete** (drop file + flag, defer to BACKLOG), or **wire it up** (integrate behind FF with `/tmp` quota guard, RD quota probe, Resemble fallback). Decide before P2 starts.
12. **Rate-limit fail-policy + cache versioning + positional indexing fix** — single rule documented in `packages/utils/src/rate-limit.ts`: fail-closed in prod for paths touching a paid downstream (AI calls, Twilio, RD); fail-open for read-only/telemetry. `checkImageUploadRateLimit` flips from fail-open to fail-closed (paid Claude vision). Cache key in `apps/web/lib/analysis-cache.ts` includes `PROMPT_VERSION` from `packages/scam-engine/src/claude.ts` (today: silent cross-prompt cache poisoning). Entity-enrichment `Promise.allSettled` indexing in `entity-enrichment.ts:242` switches from positional (`results[2]?.status`) to a keyed `Record<string, PromiseSettledResult>`.

### P3 — Documentation reconciliation (Tier 4; 1 PR)

13. **ARCHITECTURE.md / BACKLOG.md / CLAUDE.md doc sweep** — partial overlap with existing **"Reconcile feed cadence docs"** under [Database Hygiene → Non-schema advisor TODOs](#non-schema-advisor-todos). Specifics: remove all Paddle references (v59 migrated to Stripe); correct feed-sync to weekly Sunday 07:00 UTC (not 15-min); update Inngest function count to actual (13: staleness×3, enrichment, ct-monitor, entity-enrichment, urlscan, cluster-builder, risk-scorer, scam-alerts, feed-sync×2, meta-brp); update table count to current migration tip; add legacy admin-token EOL date (e.g. 2026-05-28) in `apps/web/lib/adminAuth.ts` top-comment + ops runbook.

### P4 — Lower-priority cleanups (Tier 5; backlog candidates, no PRs scheduled)

- **§7 architectural** — collapse synchronous WHOIS/SSL writes in `/api/scam-urls/report` to use the same `enrichment_status='pending'` CAS path the Inngest fan-out uses, eliminating the race
- **§27 reliability** — invitation resend throttle (per-(org, email) per hour) on top of the P0.3 accept-rate-limit
- **§9 security** — replace `extension_installs.status != 'revoked'` (blacklist) with `status = 'active'` (whitelist); a future status value would otherwise implicitly pass
- **§15 reliability** — `mark_stale_*` runs at 03:00 UTC; pick a WAL-aware time slot
- **§3 security** — extension `/api/extension/analyze` route doesn't store `verified_scams`; product call on whether extension HIGH_RISK should contribute to the threat DB (currently silent)
- **§1 security** — `scrubPII` before caching (low risk; cached SUSPICIOUS entry may echo user PII back to a SHA-collision caller — practically the same caller, but defense-in-depth)
- **§1 reliability** — base64 image size check happens _after_ decode; reorder so the 4 MB cap applies to base64 length (~5.6 MB threshold) before allocation
- **§38 reliability** — most threat-feed scrapers are manual-dispatch only in `.github/workflows/scrape-feeds.yml`; ARCHITECTURE.md narrative implies daily-fresh threat intel, but only the Reddit scraper is on cron. Add per-feed schedules

### CI hygiene (separate, not part of any tier)

- **`autofix` CI failing on every PR** — pre-existing across #35/#39/#40/#41 (this PR will hit it too). The autofix-ci action runs a formatter that wants to reformat ~80 files across `packages/scam-engine/`, `packages/site-audit/`, `packages/types/`, `packages/utils/` but its own safety rule forbids touching `.github/`, so the run errors out without writing fixes. One-shot fix: run the formatter locally (`pnpm turbo lint --fix` or per-package equivalents), commit the diff, restore green check on subsequent PRs

### Open decisions (block the corresponding tier)

1. **Deepfake direction** (blocks P2.11) — park / delete / wire. Park is the recommended least-regret option (preserves the work, removes the foot-gun).
2. **Stripe customer-mapping table existence** (blocks P0.2) — verify whether a `user_stripe_customers` (or similar) mapping table is already in `supabase/`. Run `mcp__supabase__list_tables` filtered for `stripe`/`customer`, or `ls supabase/ | grep -i customer`. If absent, the migration is part of the same PR.
3. **Async Twilio UX call** (blocks P1.8) — moving Twilio off the sync path means the verdict response no longer carries `phoneIntelligence`; UI either polls or shows a "checking phone…" pill. Confirm UX, or take the smaller 1.5s in-line timeout instead.

---

## Audit Round 2 Remediation (2026-05-05) — deferred items

The Round-2 codebase audit (2026-05-05) closed the bulk of items via PRs
#125-#133. The list below is what's _intentionally not in the sprint_ —
either because it requires a fresh signup (Google Play, Apple Developer)
or because it's a multi-week build that didn't fit the side-bug pass.

### Requires external signup (not unblocked yet)

- **Real device attestation (Play Integrity + App Attest)** —
  `apps/web/app/api/mobile/attest/route.ts` returns `501` in production
  (W1.3 fail-loud guard, also covered by P0.1 above). Lifting that 501
  needs **(a)** Google Play Console enrolment + Play Integrity API
  credentials and **(b)** Apple Developer Program enrolment + App Attest
  configuration. Both are paid annual signups. The route's flag stays
  default-OFF and the 501 stays in the production hot path until both
  exist. No code change unblocks this.

### Significant scope (not signup-blocked, just deferred)

- **Visual fingerprinting / `voyage-multimodal-3.5` call path (item h
  from Round-2 audit)** — model is registered with `callPathReady: false`
  and throws on invocation. Implementing it requires a new
  `visual_fingerprints` table (migration), an Inngest screenshot-embed
  consumer, and a clusterer for the multimodal vectors. ~2 weeks of work
  and no consumer surface justifies the spend yet — submission volume
  on screenshots is well below the threshold where dense visual
  retrieval would beat the existing OCR+text path. Re-evaluate if image
  submissions exceed 100/day for two consecutive weeks.

- **Dual-embedding drift detection (item g from Round-2 audit)** —
  `dual_consistency` column on `scam_reports` would track
  `cosine(raw_text_embed, prefixed_text_embed)` per row to flag
  population-level drift via Evidently or similar. The column is a
  small migration; the alarm tooling is the load-bearing piece and
  requires either Evidently in the stack or a custom rolling-quantile
  job. Defer until volume + staffing justify a drift dashboard.

- **Inngest fixture-extraction job (PR #133 follow-up)** — the
  promptfoo skeleton in `evals/` ships with hand-curated fixtures.
  The full audit-item-(i) closure needs an Inngest cron that reads
  `verdict_feedback WHERE training_consent = true AND processed_at IS
NULL`, generates `evals/fixtures/auto/<id>.yaml` candidates, and
  marks the row `processed_at = NOW()`. **Crucially**, auto-extracted
  fixtures should NOT be promoted into the regression suite without
  human review — a single mis-labelled feedback row in the gate
  poisons every PR check after that. Requires a small `/admin/eval-fixtures`
  triage UI: list pending fixtures, allow accept-into-curated /
  reject. Cost-budget guard on the eval workflow (abort if cumulative
  Anthropic spend > `EVAL_BUDGET_USD`, default $1) ships in the same
  PR.

### Cosmetic / nice-to-have

- **`FeedbackDisagreementTile` on `/admin` dashboard** — the daily
  Telegram digest from W1.1 (`/api/cron/feedback-digest`) covers
  operator awareness on disagreement spikes. A dashboard tile would
  be redundant for monitoring but useful for at-a-glance trend
  inspection during incident review. Bundle with the next
  `/admin` revamp; no standalone PR warranted.

- **Cost-telemetry tagging for the new retrieval modules** — both
  `getSimilarReports` (PR #126) and `getRelevantThemes` (PR #132) hit
  Voyage but don't currently emit `cost_telemetry` rows. The
  retrieval modules need a small refactor to thread token counts
  back from the Voyage client into a `logCost({ feature: 'similar-reports' | 'rag-themes' })`
  call. Comments in `packages/scam-engine/src/rerank.ts` already
  flag this as a TODO. Single small PR; not on any critical path.

- **Themes-on parallel eval coverage (PR #133 follow-up)** — when
  `FF_RAG_THEMES` is on the prompt has different context, so the
  current `evals/fixtures/*.yaml` set covers only the OFF path. Add a
  parallel `evals/fixtures-with-themes/` set that locks behaviour
  with the themes block. Trivial once promptfoo is wired.

- **PR-comment summariser for promptfoo** — the workflow in PR #133
  uploads `evals/output.json` as a build artifact. Wiring a job that
  posts a pass/fail count + drift diff into the PR comment would
  give reviewers a one-glance answer without downloading the
  artifact. Standard `actions/github-script` pattern.

---

## Result Screen V2 — follow-up sprints

P0 (feedback widget, two-button footer, invalid-state, honest progress) is now
the default experience — the `NEXT_PUBLIC_FF_RESULT_SCREEN_V2` flag was retired
alongside the AskSilver-inspired simplification (v67 migration widens the
`verdict_feedback.user_says` CHECK to accept `user_reported`). Queued follow-ups:

- **Structured red-flag payload** — `redFlags` is currently a flat `string[]` and
  `ResultCard.splitFlag()` heuristically splits on the first sentence boundary
  to derive `{ heading, body }` for the left-bar cards. Update the Claude
  analyze prompt + `@askarthur/types` schema to return `Array<{ heading, body }>`
  directly, then retire `splitFlag()`.
- **P1 onward-reporting** — destination picker `OnwardReportingCard`,
  `onward_report_log` + `brand_abuse_contacts` tables + `get_onward_destinations`
  RPC, Inngest workers for brand-abuse email + ACMA spam forwarding + Scamwatch/
  ReportCyber/IDCARE deep-link handoffs, Resend templates (`brand-abuse-report.tsx`,
  `acma-spam-forward.tsx`), SPF/DKIM/DMARC for `reports@askarthur.au`,
  `NEXT_PUBLIC_FF_ONWARD_REPORTING` flag. Currently "Report this scam" POSTs
  `userSays: "user_reported"` to `/api/feedback` and opens the Scamwatch portal
  in a new tab — the picker replaces that with a structured handoff.
  - **Producer wiring gap (2026-07-12 fleet review).** `OnwardReportPicker`
    already accepts + forwards `hasFinancialLoss` / `hasPiiCompromise` to
    `/api/report/destinations`, but `ResultCard` never passes them and **no code
    path anywhere produces these two signals** — so ReportCyber + IDCARE
    (gated on financial-loss / PII in `get_onward_destinations`) can never
    surface. Deriving them from `scamType` would be wrong ("finance-shaped scam"
    ≠ "user lost money"). Correct fix: source them from a user micro-question
    (unify with the Next Steps funnel's `bestNextStep` micro-flow, which already
    asks the user), then thread through `ResultCard` → picker. Do this when
    launching onward reporting.
- **P2 governance + self-service** — `/settings/my-data` (view + delete feedback
  and submissions), quarterly brand-contacts staleness cron, nightly SMTP probe
  on abuse inboxes, PIA document + public summary, admin triage queue for
  false-positive feedback, unsubscribe/encryption helper for `followup_email`.
- **`known-brands-discover` security.txt re-probe of 'none' rows** — today
  coverage is one-shot per brand: a miss writes a `contact_type='none'` ledger
  row and the candidate gate then treats the brand as covered forever, so a brand
  that publishes security.txt _after_ its first probe is never re-discovered
  (2026-07-12 fleet review corrected a header that wrongly claimed a 90d re-probe
  already existed). To implement: add a `probed_at` column set on every probe,
  switch the miss-path upsert off `ignoreDuplicates`, and re-include `'none'`
  rows with `probed_at < now() - 90d` in the candidate set.
- **Extension + mobile parity** — thumbs widget + simplified card + destination
  picker on both `apps/extension/src/components/ResultDisplay.tsx` and
  `apps/mobile/components/AnalysisResult.tsx`. Neither surface has any feedback
  UI today; both still render the pre-simplification layout (confidence meter,
  next steps, brand prompt, recovery guide).
- **Honest progress via streaming** — current P0 approximates with client-side
  fetch-boundary transitions. If `/api/analyze` gains SSE or streaming JSON,
  swap `AnalysisProgress`'s `currentStep` prop to read actual server events.
- **Restore deferred signals** — confidence meter, deepfake gauge, scam-report
  card, brand verification prompt, recovery guide, and Scamwatch CTA were
  removed from the hero web card to match competitor simplicity. Components
  remain on disk (`DeepfakeGauge.tsx`, `RecoveryGuide.tsx`, `ScamReportCard.tsx`)
  for reuse in the B2B dashboard, audit reports, or the extension popup.

---

## Mobile

- [x] AI consent modal (Apple Guideline 5.1.2(i) compliance)
- [x] Recovery guidance component (Australian contacts)
- [ ] Push notifications (scam alerts for your area) — backend complete (v32 `device_push_tokens`), UI pending
- [ ] Call screening via Android CallScreeningService
- [ ] SMS filtering via iOS ILMessageFilterExtension
- [ ] Offline scam database (expo-sqlite) for common patterns
- [ ] Share extension (analyse content from other apps)
- [ ] Biometric auth for scan history
- [ ] Scam simulator (educational tool — spot the fake)
- [ ] Family protection (manage multiple numbers) — backend complete (v33 `family_groups`/`family_members`/`family_activity_log`), UI pending
- [ ] Dark/light theme toggle

## Telegram

- [ ] Image/screenshot analysis (send photo of scam)
- [ ] Phone number lookup (Twilio integration)
- [ ] Group mode (add bot to group, auto-scan links)
- [ ] Telegram Stars payments (premium features)
- [ ] Streaming analysis (show results as they come in)
- [ ] Multi-language support

## WhatsApp

- [x] AI disclosure welcome message (Meta compliance)
- [x] "About" button for AI transparency
- [ ] Image analysis (forward screenshot of scam)
- [ ] Document analysis (PDF/Word attachments)
- [ ] Phone number lookup
- [ ] Status/story link checking
- [ ] Business API catalog integration

## Slack

- [ ] Message shortcut (right-click any message to check)
- [ ] Workspace dashboard (admin stats)
- [ ] Automated email scanning (forward channel)
- [ ] Scheduled reports (weekly scam trends)
- [ ] Slack Connect support (cross-org)

## Messenger (Facebook)

- [ ] Full platform (deferred — Meta approval process is lengthy)
- [ ] Same feature set as WhatsApp bot
- [ ] Instagram DM integration

## Browser Extension

- [x] Email HTML/CSS injection hardening (hidden element stripping + server-side sanitization)
- [x] WXT `filterEntrypoints` inclusion-list gating — content scripts only ship in the manifest when their build flag is on. v1.0.0 minimal manifest has no `content_scripts` key at all (2026-04)
- [x] Per-install ECDSA P-256 signing (replaces shared-secret auth; Cloudflare Turnstile-gated registration; ±5 min skew; Redis nonce-replay protection) (2026-04)
- [x] Facebook ads content script + marketplace trust scoring + PayID chat detection — code shipped in v1.0.1 bundle, **flag-gated off** behind `WXT_FACEBOOK_ADS` + `NEXT_PUBLIC_FF_FACEBOOK_ADS`
- [ ] **URL Guard (`url-guard.content.ts`)** — code shipped, flag-gated off behind `WXT_URL_GUARD`. Activates phishing warning overlays on navigation. Server path is cheap (Google Safe Browsing + threat-DB, no Claude). Requires v1.0.2 manifest bump + `<all_urls>` host permission → sensitive-permission CWS re-review
- [ ] **Selector regression tests for `ad-detector.ts`** — Facebook restructures feed DOM ~monthly; capture 5–10 real feed HTML fixtures, write assertions against `detectSponsoredPost()` so we catch silent breakage within hours of any Facebook ship
- [ ] **Per-install hourly cap on `/api/extension/analyze-ad`** (60/hour) — defence-in-depth atop the existing 50/day bucket. Bounds worst-case MutationObserver misbehaviour (infinite feed on a hostile clone) and caps spend per extracted-secret attacker
- [ ] Email scanning via forwarding model (forward to analyse@askarthur.au)
- [ ] Page content analysis
- [ ] Phishing site warning overlay (distinct from URL Guard — proactive, not reactive)
- [ ] Safe browsing indicator in toolbar
- [ ] Website permission check — audit a site's requested browser permissions (camera, mic, location, notifications, clipboard) and flag overreach. Similar to the existing URL check but focused on permission hygiene rather than scam detection
- [ ] Website vulnerability check — scan a site for common security issues (mixed content, missing HSTS, open redirects, outdated TLS, exposed admin panels, missing CSP). Not scam detection — aimed at helping site owners and users understand if a site is safe to interact with. Results stored in `site_audits` table for trend analysis

## Website Safety Audits (Extension + Web)

Cross-platform features to help users and site owners assess website security — complementary to scam detection.

- [ ] **Permission check** — audit a website's requested browser permissions (camera, microphone, location, notifications, clipboard, payment). Flag overreach (e.g. a blog requesting camera access). Extension: real-time check on page load. Web: paste a URL to audit. Report card with permission-by-permission breakdown and risk assessment
- [x] **Vulnerability check (Phase 1)** — basic security header + TLS scanner with letter grade, deployed at `/audit`. Full version (open redirects, exposed admin panels, outdated server software) still TODO
- [ ] **Vulnerability check (Phase 2) — aka URL Security Report** — extended scanning. Scoped in Phase 14 Sprint 5 (see `ROADMAP.md` and `docs/vulnerability-tooling-expansion.md`). Only **7 net-new checks** vs. what `packages/site-audit` already ships: SEC-001 (Next.js `x-middleware-subrequest` / CVE-2025-29927), SEC-002 (React version fingerprint / CVE-2025-55182), SEC-003 (HTTP request smuggling probe), SEC-004 (cache-key confusion probes), SEC-006 (post-quantum TLS support / X25519MLKEM768), SEC-007 (certificate freshness — scam-infra signal), SEC-008 (SMTP smuggling MX probe / CVE-2023-51764-6). SRI, open-redirect, security-txt, security-headers, CSP, cookie-security, CORS, mixed-content, DNSSEC, SSL cert, TLS version, email-security, permissions-policy already exist as check modules.
- [x] **`site_audits` table** — created in v20 with schema: `site_id`, `overall_score`, `grade`, `test_results` (JSONB), `category_scores` (JSONB), `recommendations` (TEXT[]), `duration_ms`, `scanned_at`. Phase 14 Sprint 5 URL Security Report reuses this shape; Phase 14 adds `audit_type` only if the existing columns can't represent the new SEC-\* check class (TBD during implementation)
- [ ] **Site safety badge** — embeddable badge for site owners who pass audits (like SSL badges). Links back to askarthur.au with full report

## B2B / API

- [ ] **Phone Intel Card for B2B/Gov** — re-enable PhoneIntelCard UI (currently hidden from consumer web app) for paid government/enterprise tiers. Shows Twilio Lookup v2 data: carrier, line type, VoIP detection, CNAM caller name, 0-100 risk score. Phone intelligence still runs in the background and feeds into enrichment pipeline + risk scoring — this is just the consumer-facing card
- [x] Threat intel export views (4 views for government/law-enforcement data export, v38)
- [x] Provider reporting API (`submit_provider_report`, `get_unreported_entities`, v39)
- [x] Financial impact tracking (`record_financial_impact`, `get_jurisdiction_summary`, v40)
- [ ] Public entity API (batch scam checking)
- [ ] Threat intelligence feeds (real-time scam data)
- [ ] Brand monitoring (detect impersonation)
- [ ] Carrier feeds (Telstra/Optus integration)
- [ ] White-label widget (embed on any site)
- [ ] Webhook notifications for new threats
- [ ] SOC integration (SIEM connectors)
- [ ] **Shop Signal "Ask Arthur Verified" merchant badge (Shopify)** — a trust seal a _legitimate_ merchant embeds on their store, distinct from the consumer Shop Signal (which protects _shoppers_ from fake shops). Parked at the 2026-05-22 distribution review: it is a separate product and a separate B2B motion, not Shop Signal as built — the consumer feature ships to the web app + Chrome extension (#323) first. Revisit only if merchant-side demand surfaces; the real scope is a Shopify App Store listing + a verification/issuance flow, not a small add-on.

## Government Reporting

Infrastructure is in place (v38–v40). Future work:

- [ ] Automated ACCC Scamwatch submission (API integration when available)
- [ ] Bank API integration (CBA/NAB/WBC/ANZ fraud reporting endpoints)
- [ ] Telco number-blocking requests (Telstra/Optus APIs)
- [ ] ACSC cyber incident automated reporting
- [ ] AFP ReportCyber integration
- [ ] State police jurisdiction routing (using `get_jurisdiction_summary` data)

## Pipeline / Scrapers

- [ ] Fix broken scrapers (manual-only, low priority): ThreatFox (401 — API key expired), crt.sh (NoneType `.strip()` — null domain bug), PhishStats (95s timeout — upstream slow/down), CryptoScamDB (404 — GitHub source gone, likely dead)

### News Intel narrative feeds (shipped 2026-05-06, post-launch watch)

- [ ] **Akamai tarpit on Azure (GH Actions) IPs targeting cyber.gov.au** —
      Diagnostic probe (`probe_acsc.py`, run via PR #145, 2026-05-06) returned
      41/41 ReadTimeout failures across 5 UAs × 4 endpoints × 2 methods + a
      urllib parity check. All identical 15s read-timeout. DNS resolves
      (Akamai 23.210.244.0/24 — NOT Cloudflare as initially assumed); TLS
      handshake completes in 6ms. So this is **deliberate Akamai bot
      protection silently dropping responses for Azure egress IPs** (GH
      Actions runs on Azure 135.232.0.0/16). Even `googlebot` UA on
      `/robots.txt` is tarpitted — proves it's IP-range based, not
      UA/endpoint filtering.  
       **Mitigation already shipped**: `pipeline/scrapers/common/backoff.py`
      skips ACSC fetches once 5 consecutive failures are logged. The 3h
      cron still fires but writes a `partial`-status heartbeat instead of
      hammering the upstream. Resets automatically when one fetch succeeds.  
       **Diagnostic tooling**: `pipeline/scrapers/probe_acsc.py` runs HEAD/GET
      across multiple UAs (askarthur, mozilla, curl, googlebot, no-UA),
      multiple endpoints (rss/alerts, rss/advisories, /, /robots.txt), and
      cross-checks `requests` vs stdlib `urllib`. Plus DNS resolution + raw
      TCP+TLS handshake probes. Trigger via
      `gh workflow run scrape-feeds.yml -f feed=probe_acsc` to capture a
      diagnostic table. **Run the probe BEFORE attempting the Inngest port
      so we're not optimising for the wrong cause.**  
       **Vercel ingest (in code, gated default OFF)**: PR #147 ships
      `packages/scam-engine/src/inngest/acsc-ingest-vercel.ts` — a parallel
      Inngest cron that fetches ACSC RSS from Vercel's runtime instead of
      GH Actions. Gated by `FF_ACSC_INGEST_VERCEL` (server-side env). To
      validate Vercel egress works:
  1. Set `FF_ACSC_INGEST_VERCEL=true` in Vercel preview
  2. In Inngest dashboard, manually invoke `acsc-ingest-vercel`
  3. Query `SELECT status, records_new, error_message FROM
feed_ingestion_log WHERE feed_name='acsc' ORDER BY created_at
DESC LIMIT 3` — first row is the Vercel run
  4. If `success` with `records_new > 0` → flip flag to true in prod,
     open follow-up to remove the Python GH Actions step
  5. If `error` (Vercel IPs also tarpitted) → flip flag off, accept
     the gap (Scamwatch + ASIC cover most AU regulator-narrative
     needs), open separate ticket to scrape the HTML listing instead
     of RSS as Plan C.
     **Fallback (Plan C)**: scrape `/about-us/view-all-content/alerts-and-advisories`
     HTML listing — different Akamai cache/WAF rules than RSS endpoints,
     may pass through. Only consider if Vercel egress also fails.  
      Health query: `SELECT status, COUNT(*) FROM feed_ingestion_log WHERE
feed_name='acsc' AND created_at > now() - interval '7 days' GROUP BY
status`. Healthy week is mostly `success`; an unhealthy backoff week
     is `error` followed by `partial` (the Python backoff heartbeats).

- [ ] **FTC / FBI / UK / NCSC narrative scrapers** — not built; pattern
      matches `acsc_alerts.py`. Feed URLs from the original brief require
      re-validation (FTC's `consumer-alerts/feed` is 404 as of 2026-05-06).
      Estimated ~150 LOC each + cron line. Defer until AU sources are
      proven steady-state for 4+ weeks.

- [ ] **Google Web Risk migration** — `safebrowsing.ts` currently uses
      Safe Browsing v4 which is non-commercial-only per Google's ToS. Web Risk
      is the commercial replacement: 100k Lookup calls/month free, then
      $0.50/1k. Free tier alone covers our volume. **Trigger**: commercial
      launch / monetisation event.

- [ ] **OG image upload to R2** — narrative scrapers extract `og:image`
      but currently don't upload to R2. Adding the upload path means adding
      `evidence_r2_key` to the bulk_upsert and uploading via existing
      `common/r2.py`. Defer until a renderer (email card, dashboard preview)
      needs it.

- [ ] **Re-run ACSC manually after 24h** — first-launch ACSC scrapes all
      timed out from GH IPs. After Mozilla UA fallback ships in PR #140, the
      3h cron should self-heal. Verify after 24h via
      `SELECT * FROM feed_ingestion_log WHERE feed_name='acsc' ORDER BY created_at DESC LIMIT 10`
      — at least one `success` with `records_new > 0` expected.

- [ ] **Daily Telegram cost digest — verify after 7d** — the existing weekly
      WoW cost digest auto-includes any feature found in `cost_telemetry`.
      After 7 days of `news-intel-embed` cost data has accrued (target date
      ≥ 2026-05-13), check the Mon Telegram digest contains a
      `news-intel-embed` line. **No code change needed** — verification only.

- [x] **Daily admin health digest (silence-on-perfect-day)** — shipped via
      PR-H. `/api/cron/health-digest` runs at 22:00 UTC (08:00 AEST) daily,
      queries cost_telemetry for `*-error` rows + feed_ingestion_log for
      stale feeds, sends Telegram only when issues detected. Per-feed
      staleness thresholds in route.ts; known-dormant scrapers excluded.
      When the Vercel ACSC ingest (PR #147) confirms green, revert the
      `acsc` threshold from 999h (silenced) to 12h.

- [ ] **`/intel/regulator-alerts/[slug]` detail pages (P3)** — surface
      per-alert detail pages with full body_md rendered, breadcrumbs, and
      per-source schema.org markup for SEO. Requires a `slug` column on
      `feed_items` (currently the dedup key is a SHA-256 hash). Implementation
      notes when picked up:
  - Add `slug TEXT` column on `feed_items`, backfilled from a slugified
    version of `title` + a 6-char hash suffix to avoid collisions.
  - Update the three narrative scrapers to populate `slug` on insert.
  - Build the `[slug]/page.tsx` route mirroring `/intel/regulator-alerts/page.tsx`.
    Defer until `/intel/regulator-alerts` (the list page) shows clear SEO
    signal — Plausible referrers from search engines pointing at it.

- [ ] **Mobile `RegulatorAlertsScreen` UI** — `/api/mobile/regulator-alerts`
      shipped in PR #144 (gated default OFF). The mobile app needs a screen
      to render the response. Pickup signal: when @askarthur/mobile is next
      bumped for an Expo release, add the screen and flip
      `NEXT_PUBLIC_FF_MOBILE_REGULATOR_ALERTS=true` simultaneously.

## Reddit Scam Intelligence — priority watch

Plan: [docs/plans/reddit-intel.md](./docs/plans/reddit-intel.md). All 14 PRs (#55–#68) merged 2026-05-02; pipeline is live and producing data within cost budget. Email digest + public theme page redesigned in #124 (2026-05-05). Active watch items:

- [ ] **🔴 Cluster threshold tuning** (priority: HIGH) — initial 0.78 produced 77 themes for 77 posts (1:1 ratio, no grouping). Lowered to 0.62 empirically on 2026-05-02 (this commit). After ~3 days of fresh batches at the new threshold, query `SELECT count(*) AS themes, max(member_count), avg(member_count), percentile_cont(0.5) WITHIN GROUP (ORDER BY member_count) AS p50_size FROM reddit_intel_themes WHERE is_active=true`. Healthy distribution: 5–15 themes per batch with a long tail of single-post outliers and the top 3 themes having 5+ members each. If still 1:1 → drop to 0.55 OR simplify embed text to narrative-only (requires bulk re-embed). If themes balloon to 50+ members → bump back to 0.70.
- [ ] **OpenAPI spec rewrite** for `/api/v1/intel/*` endpoints — `apps/web/app/api/v1/openapi.json` predates v82. Tracked in PR #63 description as low-priority.
- [ ] **B2B exec brief variant** of the weekly email — F-10 from the original brief proposed a separate audience='b2b' digest with sector-exposure framing. Defer until first paying B2B customer asks; current digest is operator-only.
- [ ] **`/for-business/brand-watch` landing page** — PR #124 deferred this. Public marketing page that pitches Reddit-monitoring + shows brand-filtered theme teaser + trial CTA, deep-linkable as `?brand=<slug>`. Revisit once email CTR signal on the new theme deep-links is in. Until then, brand chips in the digest stay plain text.
- [ ] **Per-brand chip links in the weekly digest** — pairs with the brand-watch landing page above. Email already exposes `topBrands[*].brand` + `mentionCount`; only the link target is missing.
- [ ] **Inline Reddit permalinks under each emerging theme in the email** — PR #124 ships theme→on-site-page only. Cheap follow-up: aggregator fetches top 1–3 source URLs per theme via `reddit_post_intel.theme_id → feed_items.source_url` and email renders them as small "View source" chips. Skipped initially because the new `/intel/themes/[slug]` page already lists every member permalink, so the value is mostly speed-to-source for power readers.
- [ ] **Public `/intel/themes` browse index** — PR #124 ships only the `[slug]` detail page. A slug-list index (newest themes first, sortable by member count or recency) would unlock SEO entry beyond email and become the natural canonical for "Australian scam patterns" queries. Defer until ≥30 active themes exist to avoid an empty browse page.
- [ ] **Privacy advisor sign-off** on retention windows (180d body NULL, 365d quote DELETE) — non-blocking until first row hits 180d (~Nov 2026 at earliest). Docs at `docs/compliance/reddit-intel-privacy-impact.md`.
- [ ] **Reddit OAuth migration** — current scraper uses unauthenticated JSON endpoints; migrate to PRAW-style OAuth when subscriber count crosses 1k or Reddit's Public Content Policy materially tightens. Roadmap in `docs/compliance/reddit-intel-reddit-tos.md`.
- [ ] **Formal takedown runbook** — currently described as "manual SQL" in the Reddit ToS doc §6. Could formalise into a step-by-step ops playbook when the first takedown notice arrives.

## Outreach & Partnerships

Active outreach pipeline tracking. Email bodies and full pitch context live with the original campaign assets at `docs/campaigns/spf-pillar-2026-04/02-…`/`03-…`/`04-…` until the campaign is archived. Status flips here, not in the campaign folder.

| Contact               | Role                    | Asset                                                                                                                                   | Status                      | Next action                                                                                                          | Sent | Response |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---- | -------- |
| David Lacey / IDCARE  | CEO                     | `02-email-davidson-idcare.md` (referrer-to-funder partnership: paid subscriber + co-branded referral + threat-data + SPF working group) | _unknown_                   | Confirm whether sent; if not, send before 1 Jul 2026 — gates Walsh/Vocus warm intro and the AEA Parwada conversation | —    | —        |
| Iñaki Berroeta / TPG  | CEO                     | `03-email-chiarelli-tpg.md` (content-layer pitch complementary to Mavenir + Apate.ai, 90-day pilot at A$2k/mo)                          | _unknown_                   | Confirm whether sent                                                                                                 | —    | —        |
| Kevin Russell / Vocus | CEO                     | `04-email-walsh-vocus.md` (warm-intro via IDCARE, content-layer pitch for Dodo/iPrimus/Commander)                                       | Blocked on IDCARE intro     | Wait for IDCARE acknowledgement before sending                                                                       | —    | —        |
| Optus                 | Telco                   | (deferred from HANDOFF.md "What's NOT done")                                                                                            | Re-evaluate Q3 2026         | —                                                                                                                    | —    | —        |
| Telstra               | Telco                   | (deferred)                                                                                                                              | Re-evaluate post-1-Jul-2026 | —                                                                                                                    | —    | —        |
| Apate.ai              | Voice AI / scam baiting | (deferred — partnership rather than competition)                                                                                        | Re-evaluate post-1-Jul-2026 | —                                                                                                                    | —    | —        |
| COBA / banking        | Industry body           | (deferred from HANDOFF.md banking workstream)                                                                                           | Out of scope until Q3 2026  | —                                                                                                                    | —    | —        |

## Distribution

Channel playbooks for the 2026-04 SPF pillar campaign. Reusable patterns for future campaigns; campaign-specific framings stay archived. See `docs/campaigns/spf-pillar-2026-04/distribution/` and `08-linkedin-series.md`.

- [ ] **LinkedIn series — 6 posts on 4–5 day cadence** at `docs/campaigns/spf-pillar-2026-04/08-linkedin-series.md`. Status _unknown_; HANDOFF.md scheduled posts on Days 0/4/7/8/13/18/25 (campaign Day 0 = 28 Apr 2026). Confirm publication state, then mark complete or reschedule remainder.
- [ ] **HN submission** — `docs/campaigns/spf-pillar-2026-04/distribution/hn-submission.md`. Status _unknown_. If posted, capture inbound traffic against pillar's 6 success metrics; if not, decide whether to submit pre or post 1 Jul 2026.
- [ ] **r/AusFinance** — `docs/campaigns/spf-pillar-2026-04/distribution/reddit-r-AusFinance.md`. Same status check as HN.
- [ ] **Extract channel-etiquette into reusable doc** — once first campaign concludes, lift HN lifecycle expectations + r/AusFinance disclosure pattern + LinkedIn cadence into a campaign-agnostic `docs/marketing/distribution-playbooks.md` so the next pillar inherits the playbook for free.

## Grants & Funding

- [ ] **AEA Seed application narrative drafted** at `docs/grants/aea-seed-narrative.md`. Blocked on UNSW / A/Prof Jerry Parwada partnership letter (HANDOFF Day 21 trigger ≈ 19 May 2026). Application targets 2026 round. Apate.ai is _not_ an AEA precedent (was VC seed, not AEA grant) — the narrative leans on academic-partnership criterion + regulatory tailwind, per the doc's verification note.
- [ ] **CyberCon 2027 CFP** — submit when window opens (deferred from HANDOFF.md "What's NOT done"). Submission topic likely tracks the SPF compliance evidence we'll have built up by then.

## Policy & Regulatory Submissions

- [ ] **SPF subordinate-rules submission** template at `docs/policy/spf-submission-template.md` (6 recommendations, sovereign-tech-advocate framing). Submit to next open Treasury / ACCC / ACMA consultation. Watch for ACMA mandatory industry standard consultation post the 27 Mar 2026 TCP Code rejection.
- [ ] **Penalty-units blog post staleness — hard date 2 Jul 2026** — `05-blog-supporting-1-penalty-units.md` quotes "A$52.7M" throughout. The 1 Jul 2026 indexation event will change the headline number on day one. Calendar a 30-Jun-2026 reminder to update the blog (and any LinkedIn quotes) within 24h of the indexation announcement.

## Voyage AI / Embeddings

Source-of-truth for everything below: `docs/research/voyage-ai-audit-2026-05-03.md`. Quick wins (model bump 3 → 3.5, env-var registration, `embedding_model_version` column, ADR-0003) shipped in `feat/voyage-quick-wins-2026-05`. Remaining items ranked by ROI for a small team.

- [ ] **Embed every analyze submission → surface "N similar reports in last 30 days" on `/scan/result`** (M-effort) — the killer consumer feature. Embed in the post-Inngest consumer path (`FF_ANALYZE_INNGEST_WEB=true`), store on `scam_reports.embedding VECTOR(1024)`, build an HNSW index. ~$0.0001/scan. Turns Ask Arthur from "is this a scam?" into "how many of you have hit this exact scam this week?" — viral-loop content for the dashboard, blog auto-fills, Reddit posts. See audit Part 6 rec #3. Blocked on the query-vector retention ADR.
- [ ] **Embed all 63,637 ACNC charity names + missions; ANN-search at submission time in `charity-check`** (M-effort) — charity launch differentiator; catches semantic impersonators that trigram + Levenshtein miss ("Save Australian Children" vs "Save the Children Australia"). ~$4 one-shot to embed the corpus. See rec #5.
- [ ] **Add `rerank-2.5-lite` stage to `/api/v1/intel/themes` and (after the consumer "similar reports" surface ships) `/scan/result` similarity panel** (M-effort) — Anthropic's contextual-retrieval study shows rerank cuts retrieval failures from 49% → 67% over embeddings alone. For B2B customers paying per query, the rerank lift is what they're buying. See rec #4.
- [ ] **Switch Reddit Intel daily embed to Voyage Batch API** (S-effort) — 33% cost cut on a non-time-sensitive workload. ~$3/month saving in absolute terms but free quality-of-implementation. See rec #7.
- [ ] **Add Redis `hash(text) → vector` cache (24h TTL) in front of `embed()`** (S-effort) — saves embedding tokens on duplicates. Becomes load-bearing the moment the consumer "similar reports" surface ships (forwarded smishing texts get submitted dozens of times). See rec #8.
- [ ] **Spike `voyage-multimodal-3.5` on Hive AI Facebook-ad image corpus + Charity Check v0.2b OCR images** (L-effort) — cluster ad creatives by visual+text fingerprint. Catches deepfake / lookalike-creative campaigns. Differentiated capability — no AU competitor does this. See rec #9.
- [ ] **Refactor `EMBEDDING_PROVIDER` env to `EMBEDDING_MODEL_<DOMAIN>`** (`generic` / `finance` / `multimodal`) before adding the second consumer (S-effort) — today's two-provider switch dies the moment we want `voyage-finance-2` for crypto/investment posts and `voyage-3.5` for everything else. Get the abstraction right before cementing it across N consumers. See rec #10. Required before charity-check or multimodal embeddings ship.
- [ ] **ADR — query-time embedding retention policy** — every embedded query is a derived form of submitted user content (plausibly PII-derivative under OAIC's view). Need a max-30-day window + default-purge on user account deletion documented before the consumer "similar reports" surface ships. See audit Q3.
- [ ] **ADR — Postgres `<=>` ANN vs in-memory cosine** — required before `scam_reports.embedding` ships (>100k vectors → HNSW; <50k → IVFFlat). Decision shapes index strategy + RPC design + retry surface. Hard to reverse. See audit Q12.
- [ ] **Include `shopSignal.commerceFlags` in `buildEmbedText()` for commerce-flagged scam reports** (S-effort) — `scam-report-embed.ts` currently composes the embed text from `scrubbed_content + scam_type + channel + impersonated_brand`. Near-duplicate commerce scams (e.g. two fake-AusPost PayID stories) embed to nearly identical vectors. Adding the 11-tag `COMMERCE_FLAG_TAXONOMY` set as a structured suffix would disambiguate them and lift the "similar reports" surface's precision for commerce-shaped traffic. **Surface-this-after** the 30-day Stage-0 Shop Signal measurement window closes (gates Stage 1 PRs #319/#320/#321 first; commerceFlags volume will be quantified at that point). Plan reference: [`docs/plans/shop-guard-v2.md`](./docs/plans/shop-guard-v2.md). Diagram: [`docs/plans/assets/shop-signal-current-state.excalidraw`](./docs/plans/assets/shop-signal-current-state.excalidraw) — flagged as the red "KNOWN GAP" callout.
- [ ] **Backfill any pre-v86 vectors that lack `embedding_model_version`** — v86 migration's idempotent `UPDATE ... SET embedding_model_version='voyage-3' WHERE NULL AND embedding IS NOT NULL` covers existing rows at apply time; this entry exists so a future grep finds the policy if a stray null sneaks in. ADR-0003.

## Cost Observability & Infrastructure

Related to Phase 13 in `ROADMAP.md`. Items that need action before (or as) we hit the relevant trigger.

- [ ] **Hive AI pricing contract** — negotiate per-image rate with Hive commercial. **No longer a code blocker** (2026-07-17, extension-monetisation PR 1/#782): `PRICING.HIVE_AI_USD_PER_IMAGE` is set to the $0.003 published self-serve rate, the `hive_ai` brake (`HIVE_AI_CAP_USD`, $5/day) is live in cost-daily-check, and both call sites gate on `isFeatureBraked("hive_ai")`. Remaining action: confirm the contracted rate and adjust the constant if it differs
- [ ] **`PRICING.HIVE_AI_USD_PER_IMAGE` constant update** — once the contract is signed, add to `apps/web/lib/cost-telemetry.ts` PRICING block + swap the inline `0` at `analyze-ad/route.ts:155` for the constant
- [ ] **Threat-DB → Supabase Edge Function + Cloudflare CDN** — trigger: when `/api/extension/extension-security/threat-db` starts returning non-stub data. Requires Supabase CLI init (new `supabase/functions/` directory), ETag support in `apps/extension/src/lib/threat-db.ts`, Cloudflare DNS subdomain for caching. ~3 hours when triggered
- [ ] **`cost_telemetry` retention job** — trigger: table exceeds ~20M rows (~6 GB; Supabase Pro quota is 8 GB). Simple `pg_cron` nightly delete past 180 days, or archive to R2 first if RDTI evidence retention is wanted
- [ ] **Automated budget caps / kill-switches** — trigger: 2+ weeks of steady-state Tier-2 telemetry gives us a baseline. Hourly cron reads `today_cost_total`, flips a Redis kill-switch at `DAILY_HARD_CAP_USD` that makes `/api/analyze` + `/api/extension/analyze` return 503 until manually reset
- [ ] **Bot queue live-activation checklist** — when the first bot (Telegram/WhatsApp/Slack/Messenger) goes live: generate `SUPABASE_WEBHOOK_SECRET` (`openssl rand -hex 32`), set it in Vercel + Supabase dashboard, create the Database Webhook on `public.bot_message_queue` INSERT → `https://askarthur.au/api/bot-webhook` with `X-Webhook-Secret` header
- [ ] **SSL / HIBP enrichment-call telemetry decision** — follow-up to the 2026-07-13 WHOIS instrumentation (WHOIS now logs `feature='whois'` volume against its 1,000/mo cap). Two siblings in `entity-enrichment.ts` / `on-demand-url-enrich.ts` still emit nothing: (1) **`checkSSL`** — a direct TLS handshake with no API quota or `$` cost, so a `cost_telemetry` row would be pure noise; recommend **leave uninstrumented** unless we later want raw call-volume visibility. (2) **`checkHIBP`** — a genuinely paid API (`HIBP_API_KEY`) but gated behind `featureFlags.hibpCheck` + the key, and not currently firing; when HIBP is enabled, add a `logCost({ feature:'hibp', provider:'hibp' })` on the billable branch in `hibp.ts` (mirror the WHOIS pattern) **before** flipping the flag, so its spend is visible from call #1. No action needed while HIBP stays off.

## Ops / Infrastructure

- [ ] **ABN footer hardcode + privacy policy** — replace "ABN pending registration" with `ABN 72 695 772 313` in footer component + `/privacy` contact section
- [ ] **`ABN_LOOKUP_GUID` in Vercel** — ABR Web Services credential. `/api/abn-lookup` route already exists and `StepABNVerify` calls it. Without the env var the onboarding ABN-verify step fails
- [ ] **Vercel domain redirect direction** — confirm bare `askarthur.au` is the primary (200) and `www.askarthur.au` is a 308 redirect to bare. Critical for extension: the v1.0.1 manifest's `host_permissions` specifies the bare domain, and Chrome MV3 does NOT follow cross-origin redirects for content-script-triggered fetches
- [ ] **Resend domain verification at domain level** — not per-mailbox. After the email consolidation to `brendan@askarthur.au`, any transactional email (welcome, org invite, weekly blog alerts) will bounce if DKIM/SPF is only verified for `alerts@` or `noreply@`. Test with a welcome email to yourself post-deploy
- [ ] **Chrome Web Store v1.1.0 upload** (supersedes the v1.0.1 item — manifest bumped by extension-monetisation PR 4/#786) — build per the activation runbook in [docs/plans/extension-monetisation.md](./docs/plans/extension-monetisation.md): `WXT_IMAGE_CHECK=true` (+ `WXT_EXTENSION_BILLING=true` and/or `WXT_FACEBOOK_ADS=true` per phase) → `pnpm --filter @askarthur/extension zip` → upload to the existing unlisted listing. New `scripting` permission and/or Facebook host permissions may trigger a 1–3 day re-review. Pair each build flag with its server flag (`NEXT_PUBLIC_FF_IMAGE_CHECK` / `NEXT_PUBLIC_FF_EXTENSION_BILLING` / `NEXT_PUBLIC_FF_FACEBOOK_ADS`)

## Database Hygiene & SPF Readiness

Started as the deferred items from the 2026-04-23 advisor audit. Heavily
rewritten 2026-05-08 after a 26-PR sweep (v100–v118 + 5 ops PRs) closed
**412 of 664 advisor lints (62%)**. Full execution plan + deferred work:
[`~/.claude/plans/prancy-strolling-dongarra.md`](~/.claude/plans/prancy-strolling-dongarra.md).

### Advisor scoreboard

> **As of 2026-05-08:** 0 ERROR · 1 security WARN (HIBP toggle, manual)
> · 5 perf WARN (residual `multiple_permissive_policies`) · 245 INFO
> (`unused_index`, awaiting 30-day baseline). Down from 664 lints / 1
> ERROR / 116 security WARN / 270 perf WARN at session start.

### Active queue — ready to execute, prioritised

These items have clear scope and no blocking decisions; pick up in any
order.

1. - [ ] **P1 — Drop ~230 hot-table unused indexes (Phase 1.1 Stage C)** — baseline snapshot landed in `docs/ops/index-baseline-2026-05.md` (PR #153) on 2026-05-08; **Stage C ships AFTER 2026-06-08** with apples-to-apples re-snapshot. Per-domain drop PRs (`vulnerabilities` carries 10; `scam_reports` 12; `breaches` 11; `subscriptions` 8). **Skip `idx_acnc_name_mission_embedding_hnsw` (481 MB)** — feature-flag false negative; documented in baseline doc.
2. - [ ] **P1 — Enable HIBP leaked-password protection** in Supabase Auth dashboard. The only remaining security advisor WARN. User-action only (no migration).
3. - [ ] **P2 — Phase 4.3 ENUM consolidation (5 PRs)** — replace free-text `scam_type`, `channel` with `scam_intent_label` + `scam_channel` ENUMs; consolidate `feed_items.category` and `reddit_post_intel.intent_label` onto the shared enum. Decisions resolved 2026-05-08: pipe-delim row → `advance_fee`; drop `delivery_method` column. Plan §Phase 4.3 has the full 5-PR sequence (4.3a value-norm → 4.3b drop column → 4.3c ENUM types → 4.3d type-migrate → 4.3e Zod hardening). **Effort: L (1-2 weeks).**
4. - [ ] **P2 — Phase 8.1 cluster-builder SQL-isation (3 PRs)** — write tests first (none exist today), then recursive-CTE shadow mode for 14d, then flip. Hard prerequisite for Phase 3.4 partitioning. **Effort: L (3-4 weeks).** Plan §Phase 8.1.
5. - [ ] **P2 — Wire `logCost()` into every `/api/analyze` path** — `cost_telemetry` was at 3 rows in April, 73 in May. Spot-check whether all paid AI calls now log; if any path bypasses, fix. Code change only. (v112 retention is shipped so cost is bounded; this is about completeness of attribution.)
6. - [ ] **P2 — Run vulnerability enrichment pipeline end-to-end** — 2,139 rows in `vulnerabilities`; `vulnerability_detections` + `vulnerability_exposure_checks` still at 0. The `match-b2b-exposure` Inngest function isn't firing or has no sites to match against. Investigate + flip whatever flag is blocking.
7. - [ ] **P3 — Phase 9.2 R2 setup + enable** — workflow shipped (PR #173) gated on `vars.ENABLE_DR_DUMP`. One-time setup (4 steps documented in `.github/workflows/dr-pg-dump.yml` header): R2 bucket with Object Lock + token + GH secrets + variable.
8. - [ ] **P3 — First DR drill (Phase 9.3, scheduled 2026-07-01)** — quarterly drill per `docs/ops/dr-plan.md`. Deliverable: first drill log entry in that doc + an `apps/web/scripts/smoke.ts` post-restore validator.
9. - [ ] **P3 — Reconcile feed cadence docs** — `ARCHITECTURE.md` claims 15-minute feed sync; production runs weekly via GitHub Actions cron. Either lift the cadence or correct the doc.

### Decision-gated / external-trigger queue

10. - [ ] **Phase 5.1 audit log + Merkle anchoring** — Inngest event-sourced log + nightly Merkle anchor to R2 Object Lock bucket. **Trigger:** B2B contract or SPF Act compliance posture demands audit trail. Plan §Phase 5.
11. - [ ] **Phase 5.2 cases + state machine** — `cases`, `case_entities`, `case_transitions`, `case_evidence`, `case_notes`, `case_tasks`, `case_merges`. Bank-sellable baseline. **Triggers after 5.1 stable for 30 days.**
12. - [ ] **Phase 5.3 evidence + Object Lock Compliance bucket** — chain-of-custody for AFCA/court. **Triggers after 5.2 has at least one case in `confirmed` state.**
13. - [ ] **Phase 5.4 `spf_principle_events`** — drives the SPF scorecard widget on `/app/compliance`. Projects existing events onto the six Treasury SPF §58BB principles. **Trigger:** SPF Act 1 July 2026 alignment.
14. - [ ] **Phase 5.5 webhook delivery ledger** — `webhook_endpoints`, `webhook_events`, `webhook_deliveries` with HMAC-SHA256, ≤3-day exponential backoff, idempotency, dead-letter state. **Trigger:** B2B customer requesting webhook integration.
15. - [ ] **Phase 7.x full B2C/B2B tenancy unification** — JWT-baked tenant claims + single `tenant_id` FK + B2C synthetic tenants. **Trigger:** B2B contract surfaces a requirement current dual-column pattern can't satisfy (BYOK, residency, SSO with org-scoped IdP). Phase 7.0 mutex CHECKs already shipped (v116) so the data-integrity gap is closed; full unification is high-risk + speculative-without-trigger.
16. - [ ] **Phase 6 cold-tier R2 Parquet** — Postgres → Parquet on R2 incremental archival; manifest table; FDW for rare deep queries. **Trigger:** archive shadow tables (Phase 2.5, shipped) cross 365 days of accumulated data, OR Postgres storage cost becomes pressing. Defer until late 2026 unless triggered earlier.
17. - [ ] **Phase 3 partitioning cutover** — rebuild stale shells (feed_items_partitioned 11→26 cols; scam_reports_partitioned 17→25 cols), cut over one table at a time, wire pg_partman, BRIN-index, autovacuum-tune. **Hard prerequisites: Phase 4.3 ENUM (so shells use final types) + Phase 8.1c cluster-builder ON for ≥7 days.** Plan §Phase 3.
18. - [ ] **Partition `api_usage_log` daily** — current per-row UPSERT shape will detonate at enterprise ingestion. `pg_partman` + materialised rollups + 30d raw retention. **Trigger:** enterprise customer onboards OR `api_usage_log` crosses 5M rows.
19. - [ ] **Tenant residency groundwork** — extend `organizations` with `primary_region`, `allowed_regions[]`, `kms_key_ref`, `data_classification`. Additive only. **Trigger:** enterprise contract negotiation surfaces residency or BYOK.
20. - [ ] **Phase 8.2 HNSW memory residency audit** — `pg_buffercache` hit-ratio per vector index; raise `maintenance_work_mem`; rebuild with `REINDEX CONCURRENTLY`. **Trigger:** post-2026-06-08 (after Phase 1.1 Stage C drops resolve the unused-index noise).
21. - [ ] **Phase 8.3 `halfvec` migration** — 50% memory savings at ~1% recall loss. **Trigger:** any vector index hits 1 GB OR query p95 exceeds 200ms.
22. - [ ] **Phase 8.4 hybrid search RRF + BM25** — replace `ts_rank` on `/api/v1/intel/search` and `/api/v1/scams/search`. **Trigger:** intel-search becomes a customer-visible product surface.
23. - [ ] **Enable the four Phase-1 production feature flags** (`NEXT_PUBLIC_FF_DATA_PIPELINE`, `_ENTITY_ENRICHMENT`, `_RISK_SCORING`, `_CLUSTER_BUILDER`) and run the pipelines end-to-end so `scam_clusters`, `scam_entities.risk_score`, and `vulnerability_detections` populate with real data.
24. - [ ] **Clone-watch — add FK index on `shopfront_takedown_attempts.initiated_by_user_id`** (auth.users(id)). Advisor INFO from v140 apply (2026-05-24). Column is NULL at MVP — only Shield Pro merchant-self-serve takedowns populate it (#377). Add the index when Shield Pro ships.
25. - [ ] **Clone-watch — flip `/clone-watch` page to indexable after #371 v1 copy returns**. Currently `noindex,nofollow` for the first 7 days. Removal: drop `robots` from `apps/web/app/clone-watch/page.tsx` metadata + add `/clone-watch` to `apps/web/app/sitemap.ts` static entries. Requires lawyer-vetted v1 copy from #371 disclaimer pack.
26. - [ ] **Clone-watch — re-evaluate cross-surface dedupe vs `brand_impersonation_alerts`** during the 7-day evidence window. If bank/telco/post brands produce material duplicate noise across Layer 0 and ct-monitor.ts surfaces, add a `candidate_url` column to `brand_impersonation_alerts` (v142+) and reintroduce the dedupe step that was dropped from S0E.2 after the phantom-column finding.
27. - [x] ~~**Clone-watch v2 matcher — context-token gate to cut common-English-word FPs.**~~ **Shipped via PR #408 (Option A — scam-context-token gate)** 2026-05-24. Post-deploy verification: 5 hits / 20% FP rate over Day 1 (≥3 floor ✓, ≤30% target ✓). v3 follow-up tracked as #409 (`au`-token leaks via mid-word substring in `auto-*` prefixes).
28. - [ ] **Clone-watch — known FN: `anzbank.shop`-style concatenated short-brand typos.** Word-boundary substring (shipped 2026-05-24) requires `anz` as a standalone segment of the primary label. `anz-bank.shop` matches, `anzbank.shop` does not. Consumer scanner catches these via Google Safe Browsing + ABN-Lookup if hit. Revisit if real prod data shows we're losing meaningful signal here.
29. - [ ] **Clone-watch — Cyrillic/Greek/Latin-extended confusable normalisation.** PR-E (#494) ships IDN/Punycode only. Add a confusables fold (Unicode TR39 `confusables.txt`) so a clone like `аuspost.com` (cyrillic-а) normalises to `auspost.com`. Trigger: first observed confusable FN in prod (currently none). Effort ~½ day.
30. - [ ] **Clone-watch — STOP-suppression decay (90d re-attempt).** When a brand replies STOP, `clone_alert_recipient_is_suppressed` returns true forever. Brands rotate fraud teams; re-attempt after 90 days. Add `suppressed_until timestamptz DEFAULT (now() + interval '90 days')` to the suppression check. Currently zero brands have STOP'd; defer until first one does.
31. - [ ] **Clone-watch — CT-firehose ↔ NRD source-dedup.** If the CT-firehose subscriber lands (Phase B of ADR-0016), the same candidate domain could surface from both NRD lexical AND CT lookalike. The `(alert_id, channel_type)` UPSERT on the queue keeps email idempotent, but the operator sees two pending rows. Add a `source` column or dedup at ingest. Trigger: Phase B greenlit.
32. - [ ] **Clone-watch — watchlist auto-suggest worker.** Nightly scan of `scam_reports.impersonated_brand` for non-watchlisted brands that appeared ≥3 times in 30 days → Telegram-page admin with "add brand X to `au-brand-watchlist.ts`?" Closes the loop on "the matcher only catches brands we already know about." Effort ~1 day.

### Closed (shipped 2026-05-08)

26 PRs (#150–#173) shipped this session. Highlights:

- [x] ✅ **Sole ERROR-level finding closed** (v100 / #150) — `feed_items_all` `security_invoker=true` regression fixed
- [x] ✅ **All 134 SECURITY DEFINER lockdown WARNs cleared** (v104 + v110 / #157 + #163) — every SECURITY DEFINER function now service_role-only by default. `set_user_admin` was anon-callable — material privilege-escalation surface, now closed
- [x] ✅ **11 missing FK indexes** (v100 / #150) — `unindexed_foreign_keys` 11 → 0 (then 0 → 0 after v102's `cost_telemetry.user_id` follow-up index in v108)
- [x] ✅ **2 genuinely-missing FKs added** (v102 / #155) — 5 of 7 audit findings were wrong (already-existing under unconventional names; columns that don't exist)
- [x] ✅ **`pg_trgm` + `vector` moved out of `public`** (v103 / #156) — 9 RPCs updated atomically
- [x] ✅ **60 `auth_rls_initplan` warnings cleared** (v105 / #158) — `auth.uid()` wrapped in `(SELECT auth.uid())` across 60 policies
- [x] ✅ **13 USING(true) anon-write holes closed** (v106 / #159) — drop on `check_stats`, `email_subscribers`, `feed_ingestion_log`, `scam_*`, `verified_scams`. Real anon-INSERT/UPDATE/DELETE surface eliminated
- [x] ✅ **multi-permissive 210 → 5** (v107 + v111 / #160 + #164) — 24 redundant service-role policies dropped + 17 user/org policies OR-merged
- [x] ✅ **`upsert_site_and_store_audit` search_path pinned** (v101 / #154)
- [x] ✅ **5 defensive CHECK constraints** (v101 / #154) — confidence_score ranges, daily_limit > 0, cost_telemetry units/cost ≥ 0, body_md size cap
- [x] ✅ **Deny-all RESTRICTIVE on 33 RLS-enabled-no-policy tables** (v101 + v109 / #154 + #162)
- [x] ✅ **Index baseline snapshot** (#153) — 30-day clock started for Phase 1.1 Stage C drop sweep
- [x] ✅ **Phone Footprint retention** (#151) — `anonymise_expired_footprints` + `sweep_inactive_monitors` Inngest cron 03:15 UTC. Closes documented-but-unenforced PII gap
- [x] ✅ **`reddit_processed_posts` retention** (#151) — `cleanup_old_reddit_posts(30)` Inngest cron 03:45 UTC
- [x] ✅ **`cost_telemetry` retention + rollup** (v112 / #165) — 90d raw + `cost_telemetry_daily_rollup` table; nightly cron 04:00 UTC
- [x] ✅ **Telco event-table retention** (v113 / #166) — 730d for sim/device-swap (forensic); 365d for the rest. 7 tables. Nightly cron 04:30 UTC
- [x] ✅ **Phase 2.5 archive shadows** (v118 / #172) — 6 archive shadows for flagged_ads, deepfake_detections, media_analyses, scan_results, verdict_feedback, brand_impersonation_alerts. Nightly cron 05:00 UTC
- [x] ✅ **`phone_reputation` dropped** (v115 / #169) — superseded by `phone_footprints` (v75); zero callers
- [x] ✅ **Phase 7.0 mutex CHECKs** (v116 / #170) — `api_keys`, `phone_footprints`, `telco_api_usage`, `telco_webhook_subscriptions` now enforce single-owner invariant. `org_members` correctly excluded as M:N junction
- [x] ✅ **Phase 4.6 tier-duplication documented** (v116 / #170) — COMMENT ON COLUMN on `api_keys.tier` + `subscriptions.plan` documents `sync_subscription_tier()` as the canonical sync. (Audit corrected v2 plan: `user_profiles.tier` doesn't exist; it's duplication, not triplication.)
- [x] ✅ **Phase 4.4 JSONB schema versioning** (v117 / #171) — 11 `*_v` SMALLINT columns added across 10 tables
- [x] ✅ **Daily pg_dump → R2 workflow shipped** (#173) — gated on `ENABLE_DR_DUMP`; 4-step setup documented
- [x] ✅ **Operational docs:** `docs/ops/data-retention.md` (#167), `docs/ops/dr-plan.md` (#167), `docs/ops/index-baseline-2026-05.md` (#153)

## Breach Defence Suite — paused after PR 2 (2026-04-29)

19-PR pillar (F1–F11). Spine schema is shipped to prod (v80, three tables + RPC + RLS, all flags default OFF, zero rows, harmless if it stays paused). Full plan + pause rationale + lessons learned: [`docs/plans/breach-defence-suite.md`](./docs/plans/breach-defence-suite.md). Tracked in ROADMAP.md → Phase 16.

**Pause trigger:** original spec assumed an OAIC NDB scraper would backfill ~30 historical AU breaches (Optus, Medibank, Latitude, Genea, Gelatissimo, …). OAIC does **not** publish per-incident NDB filings publicly — only aggregate 6-monthly statistical reports. The 30-breach backfill assumption is invalidated. Three forward paths captured in plan §1b; user opted to stop and revisit.

- [ ] **Decide F4 backfill path** — three options in plan §1b: (1) build OAIC scraper for aggregate stats + curated seed for 10–30 well-known cases; (2) OAIC scraper only, defer backfill until admin UI lets editors hand-curate; (3) skip OAIC, jump to curated seed file. **Blocks PR 3 onward.**
- [ ] **PR 3 — OAIC NDB scraper** — `pipeline/scrapers/oaic_ndb/oaic_ndb.py`, weekly GH Action, populates `breach_sources_raw` with `is_verified=false`. Adds `pdfplumber` to requirements. Needs GH repo var `ENABLE_OAIC_NDB_SCRAPER=true`
- [ ] **PR 4 — `hashBreachIdentifier` helper + lookup RPC client** in `packages/breach-defence/src/breach-index.ts`
- [ ] **PR 5 — Admin UI** for `/admin/breaches/{list,[id]/edit,sources/review}`. Includes `is_redacted` toggle for court-suppressed cases (Genea precedent)
- [ ] **PR 6 — Public `/breach` + `/breach/[slug]` ISR pages** with JSON-LD Article schema + sitemap
- [ ] **PR 7 — `/api/breach/lookup` endpoint** + 30-breach backfill review. **Privacy-impact assessment required before launching identity-document hashing** (Medicare/TFN/passport) — block on legal review; ship email-only first
- [ ] **PR 8 — F2 extension breach warning ribbon** (WXT entrypoint + CORS endpoint)
- [ ] **PR 9 — F3 auto-rotate deep links** (1Password / Bitwarden / Apple Keychain) extending `/api/breach-check` response
- [ ] **PR 10 — F5 B2B aggregated breach exposure endpoint** (`/api/v1/breach/exposure`, `validateApiKey` gate, 500-item batches, OpenAPI update)
- [ ] **PR 11 — F1 DNS / SPF / DMARC / NS drift monitor** (migration v81, Inngest 6h cron, `/dashboard/domains`, email/webhook fan-out)
- [ ] **PR 12 — F8 typosquat / lookalike domain alerter** (migration v82, dnstwist permutation port, auDA takedown templates, $5/customer/day cost cap)
- [ ] **PR 13 — F9 Breach Score badge** (migration v85, SVG endpoint, embed bootstrapper, public `/breach-score` landing). Depends on PRs 2/11/12
- [ ] **PR 14 — F6 class actions** (migration v83, AusLII + OAIC + 5 firm-portal scrapers, anonymous-subscribe with double opt-in). Confirm 5 firms list + ToS at PR time
- [ ] **PR 15 — F10 recovery playbooks** (migration v84, 15 playbooks seeded as JSON, wizard UI). Editorial review (IDCare partnership?) flagged as post-launch task
- [ ] **PR 16 — F11 second-wave correlation** (migration v86, `verified_scams.metadata.breach_slug` GIN index, 15-min Inngest cron)
- [ ] **PR 17 — F7 Aftermath companion page wiring** — integration PR for PRs 14/15/16 + OG image route at `/api/og/breach/[slug]`
- [ ] **PR 18 — Ransomware DLS GitHub Actions scrapers** — 15+ scrapers in `pipeline/scrapers/ransomware_dls/`. **Blocked on Tor proxy decision** (VPS vs hosted Tor.taxi/Onion.live)
- [ ] **PR 19 — Documentation pages** (`/docs/api/breach-exposure`, `/breach-score` landing, sitemap updates, R&D CHANGELOG)

**Unship-the-spine option** — schema is harmless empty but if reclaiming the migration slots is preferred: drop the four objects per the rollback block in v80's commit message (#47), and remove the 11 `NEXT_PUBLIC_FF_BD_*` flags via a small follow-up to `feature-flags.ts`/`turbo.json`/`rate-limit.ts`.

## Charity Legitimacy Check

v0.1 + v0.2a code-complete + merged 2026-05-02 (#83 #85 #86 #87 #92). `acnc_charities` table populated (63,637 rows from data.gov.au CKAN, weekly source / daily scraper). Engine + page + routes live in main; consumer surface gated by `NEXT_PUBLIC_FF_CHARITY_CHECK` (default OFF). See [`docs/ops/charity-check-config.md`](./docs/ops/charity-check-config.md) for config + smoke-test checklist.

### ⚠ v0.2 BLOCKER — split embeddings to a sibling table BEFORE consumer launch

Incident 2026-05-09 (PR #187 + post-mortem): the 498 MB
`idx_acnc_name_mission_embedding_hnsw` index on the same physical table
as the daily-write `acnc_charities` was dropped to recover from a
Disk-IO-budget depletion warning. The index was on the daily-write hot
table because v0.1 ingested embeddings inline. **Do not recreate the
HNSW on `acnc_charities` directly when you flip the consumer flag.**

Architectural pattern to follow (matches what `verified_scams` /
`scam_reports` already do — see migrations v87–v89):

1. New migration: `acnc_charity_embeddings (abn pk, embedding vector(1024), model_version text, generated_at timestamptz)`. 1:1 with `acnc_charities`, FK on ABN cascade-delete.
2. Move `name_mission_embedding` + `embedding_model_version` columns from
   `acnc_charities` to the new sibling. Keep the columns NULL-droppable in
   `acnc_charities` for one deploy cycle (read-the-old, write-the-new) to
   avoid a flag-flip race.
3. `CREATE INDEX CONCURRENTLY ... USING hnsw ... ON acnc_charity_embeddings`. Now the daily ACNC sweep's UPDATEs on `acnc_charities` never touch the HNSW index — IO drops by the same ~95% we just clawed back.
4. Update `packages/charity-check/src/embeddings.ts` (or wherever the
   semantic search joins) to JOIN the sibling on `abn`. Single index lookup
   on the sibling stays fast.
5. Update the embed backfill Inngest function to write to the sibling
   (`acnc-charity-backfill-embed.ts`).
6. **Re-run the advisor + the disk-IO query** (`extensions.pg_stat_statements` ordered by `shared_blks_read+shared_blks_written`) BEFORE flipping `NEXT_PUBLIC_FF_CHARITY_CHECK` ON — the Disk IO Budget warning was the canary.

Why split BEFORE launch instead of "fix-it-later": the daily sweep is
already running. The moment we recreate the HNSW on the same table,
every nightly TOUCH_LAST_SEEN_SQL chunk dirties index pages again — the
exact pattern that depleted the IO budget today. The split is the
single one-time cost; deferring it just rebuys the same incident.

Ship as PR v0.2-prelaunch BEFORE v0.2c/d/e. Until that PR ships,
charity-check semantic search is unavailable (exact-name + trigram
search still works via the existing 14 MB GIN index — that's how every
public AU charity register search-bar works today, so users will not
notice).

### v0.2 — consumer launch (4 PRs remaining)

- [ ] **v0.2c — PFRA + Scamwatch overlay** — migration v85 `pfra_members` table; weekly Python scraper for `pfra.org.au` member-charity + member-agency lists; new `providers/pfra.ts` (4th pillar, weight ~0.1, others rebalance); Scamwatch alert join from existing `feed_items` (recent alerts mentioning the charity name surface as non-pillar context, NOT score input). Differentiating face-to-face fundraiser layer per the strategy memo
- [ ] **v0.2d — behavioural micro-flow (3-question)** — replace single payment-method dropdown with the strategy memo §5.2 three-question flow (ID shown? payment method? extracted name?); add `behaviouralFlags` array to input schema; wire to scorer hard-floors. ~1 file (CharityChecker.tsx)
- [ ] **v0.2e — main-checker auto-detection deep-link** — detect charity-shaped inputs in `apps/web/app/api/analyze/route.ts` (regex/keyword: charity/donate/appeal/fundraiser/ABN/ACNC + 11-digit ABN extraction); attach `charityIntent: { extractedAbn?, extractedName? }` to the response and `analyze.completed.v1` event; render CTA in AnalysisResult component. Delivers the "hybrid placement" decision in the approved plan
- [ ] **v0.2b — image OCR via Claude Vision (lanyard photo)** — `packages/charity-check/src/ocr-lanyard.ts` with specialised Claude Vision prompt extracting (charity name, ACNC number, ABN, fundraising-agency name, badge number); add image input to CharityChecker form; route OCRs first, then feeds typed-out fields into engine. ~$0.002–$0.01/image (already wired in cost telemetry; brake threshold $5/day)

### v0.3 — Australia coverage (deferred)

- [ ] State register scrapers for NSW (Service NSW), VIC (Consumer Affairs Victoria), WA (DEMIRS) — currently link-out only via `apps/web/lib/charityRegistrySources.ts`. NT/ACT/SA/TAS/QLD remain link-out; their volumes don't justify scrape automation
- [ ] AIS (Annual Information Statement) financial overlay — separate annual dataset on data.gov.au; surface % revenue to programs vs admin, charity size sanity check
- [ ] ACFID Code of Conduct signatory overlay — for charities claiming overseas activity (acfid.asn.au scrape, weekly)

### v0.4 — B2B Intelligence API endpoint (deferred)

- [ ] `POST /api/v1/charity/verify` — wraps the existing `runCharityCheck()` engine with `validateApiKey` auth, 30/min rate limit (`cc_b2b` bucket), OpenAPI spec entry. SPF Act 1 July 2026 alignment for bank/telco buyers. Engine reuse means this is mostly route + auth + spec (~2-3 files)

### Calibration / known issues

- [ ] **Typosquat threshold tuning** — current calibration is trigram ≥0.65 AND Levenshtein ≤3 (v0.2a, #92). Validated against three synthetic spoofs at smoke-test time; needs revisit once we have real user-input data to confirm false-positive / false-negative rates
- [ ] **Data freshness operator alert** — daily scrape no-ops when nothing changed; if the scraper goes >7 days without a `records_new + records_updated > 0` outcome, OR the source `metadata_modified` timestamp drifts more than 14 days behind today, raise an operator alert. Currently zero monitoring; if data.gov.au stops publishing the resource we'd silently serve stale data

### Operational follow-ups

- [ ] Smoke-test in production after `NEXT_PUBLIC_FF_CHARITY_CHECK` flip — see `docs/ops/charity-check-config.md` §6 for the seven-step checklist
- [ ] Cost telemetry verification on `/admin/costs` once real user traffic flows — confirm the `feature='charity_check'` rows aggregate correctly and the brake threshold isn't accidentally hit by autocomplete fan-out

## Web App

- [x] Phone intelligence in analysis pipeline (Twilio Lookup v2)
- [x] Phone Risk Report Card — CNAM caller name, 0-100 risk score, carrier/line-type/country grid, visual parity web + mobile
- [x] Scam recovery guidance UI (Australian contacts, collapsible)
- [x] SEO blog content seed script (7 targeted Australian scam posts)
- [x] Scam Report Card integrated into result view (contact/URL reporting)
- [x] Per-IP sliding-window rate limit on `/api/analyze` image uploads (5/h) (2026-04)
- [x] Admin cost dashboard at `/admin/costs` with today/last-7d/WoW delta/top-5 features (2026-04)
- [x] Consolidated all contact emails to `brendan@askarthur.au` (retired 8 distinct addresses across web, legal docs, pitch materials) (2026-04)
- [ ] Breach check page (use /api/breach-check from web UI)
- [ ] Bot setup wizard (guided Telegram/WhatsApp/Slack setup)
- [x] Public scam feed (`/scam-feed` + `/api/feed`, v44 `feed_items` table, Reddit + verified + user reports)
- [ ] **Deepfake detection wiring into `runMediaAnalysis`** — `lib/deepfakeDetection.ts` orchestrator + Reality Defender + Resemble SDKs are all built but `detectDeepfake()` is never invoked from the media pipeline. Needs `/tmp` buffer write (Reality Defender API requires file path) + presigned R2 GET URL (Resemble fallback). ~2 hours to wire
- [ ] **Phone intelligence consumer UI** — `/api/analyze` already returns the `phoneIntelligence` object (Twilio Lookup v2: carrier, VoIP, risk score, CNAM) but `ResultCard.tsx:74` receives it without rendering. ~30 lines to surface as a report-card block matching the existing red-flags section. Data flows to enrichment/scoring regardless; this is consumer visibility only
- [ ] **Chunked audio support for Whisper** — current hard 25 MB / ~1 hour API limit (`apps/web/lib/whisper.ts:25`). Longer uploads need segmentation + per-chunk transcription + concatenation. Currently throws at the 25 MB boundary
- [ ] Scam trend analytics dashboard
- [ ] Email forwarding analysis (forward scam emails to check@askarthur.au)
- [ ] Website permission check (web version) — let users paste a URL to audit its requested browser permissions. Report card showing which permissions the site requests and whether they're justified for the site's purpose
- [ ] Website vulnerability check (web version) — let users paste a URL to get a security health report. Check TLS version, HSTS, CSP, mixed content, open redirects, exposed endpoints. Store results in `site_audits` for longitudinal tracking

## Blog content

A multi-PR restyle moved every published blog post onto the charity-check / SIM-swap structural standard (HRs between H2 sections, three callouts in DANGER → WARNING → TIP order, bold-lead bullets, italic close). Shipped as PRs #104–#107 plus the SPF telco-readiness restyle. **Two flagship deep-dives remain on the deferred pile** — both are long-form (17–24k chars) and were going to get the structural-only pass under the agreed 15–25k exception band, but were not started before the user paused the batch.

- [ ] **`how-ask-arthur-works` (23,623 chars) — structural pass.** Currently 9 H2 sections, 0 HRs, 0 callouts. Needs HRs between every H2, plus 3 callouts (DANGER → WARNING → TIP) at strategic amplification points. Body voice (askarthur-house engineering deep-dive) should NOT be rewritten. Source mirror at `docs/blog/how-ask-arthur-works.md` already exists from a previous touch.
- [ ] **`scams-prevention-framework-compliance-guide` (17,578 chars) — structural pass + callout reduction.** Currently 10 H2, 1 HR, 9 callouts (too many — B2B band caps at 0–3). Needs HRs added between every H2, callouts pruned to 3 keeping the strongest DANGER / WARNING / TIP, and `hero_image_alt` confirmed populated. Body voice unchanged.
- [x] All other blog posts (15 of 18) restyled and live in prod via PRs #104–#107, plus SPF telco-readiness restyle as a partial Batch 5 (this PR).
- [x] Charity-check stale `reading_time_minutes` corrected from 16 → 7 (the column was set before the post was rewritten in #99; live display was already recomputed correctly at request time).
- [ ] **Consumer explainer: "Don't wait for your bank to block it — check the shop first."** Ride the Westpac ad-campaign category awareness ("your account was blocked after shopping on a scam site") — position Shop Signal / the Deep Shop Check as the _prevention_ step before the bank's reactive block. Use the `blog` skill; structural gold standard is the SIM-swap consumer explainer. Cheap, high-leverage, and independent of the Shop Signal code work. Surfaced by the 2026-05-22 distribution review.
