# Next-features handoff — 2026-07-18

**For:** a fresh agent context picking up the monetisation build.
**From:** the 2026-07-17/18 monetisation + brand-activation session.
**Read first:** [clone-watch-brand-activation-handoff.md](./clone-watch-brand-activation-handoff.md) (the money model), [clone-watch-enforcement-and-monetisation.md](./clone-watch-enforcement-and-monetisation.md) (the 5-wave plan), and the Desktop wayfinder map assets at `~/Desktop/askarthur-monetisation-map/assets/` (T1 inventory, T5 the ranked Top-8 streams, T6 go-live plan, T8 SPF alignment).

---

## 1. What shipped this session (so you don't re-do it)

- **Exposure funnel LIVE** — `FF_BRAND_EXPOSURE=true` in prod; `/brand-exposure` teaser + `brand_exposure_checked` funnel event verified (#809).
- **Brand-outreach composer + worklist LIVE** — `/admin/brand-outreach` (compose + send via Resend, test-to-self default, four-eyes) + a data-driven **"Next brand to email" worklist** RPC `get_brand_outreach_worklist()` ranking brands by weaponised/live-unactioned/campaign, already-contacted memory via `brand_outreach_log` (migration v241, applied + smoke-tested). PRs #817. Pilot-email copy = A$300/mo, first month free.
- **Stripe: pilot product live** — "Ask Arthur Brand Monitor — Pilot" A$300/mo AUD GST-inclusive (`price_1TuQEZCBTRBz0dFarjtLhsLV`, `metadata.plan=brand_pilot`). The premature A$1,950/A$2,950 self-serve products were **archived**; their env vars are **blanked** (self-serve ladder deferred — see §Pricing). Webhook already exists + subscribes to the right events; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` already in prod. Brand webhook branch (#814) is **inert** until self-serve price IDs are set.
- **Hive image-check backend FIXED + verified** — `hive-ai.ts` migrated V2→V3 (#816); the existing `HIVE_API_KEY` works on V3 (live-tested). A generatorSource bug (picked V3 audio classes) found via live test + fixed (#819). Classification verified correct end-to-end. The consumer feature stays **dark** (flags off, CWS not published).
- **SPF packaging** — evidence-appendix template + `/spf-assessment` retarget + stale-date fixes (#812). **Legal review pack** for all brand-facing sends drafted at `docs/policy/brand-comms-legal-review-pack.md` (#818).
- **Compliance fix** — `wa_scamnet` flipped to ingest-only (WA Crown copyright bars commercial reuse), v240 + edge-fn deploy (#811).

**Pricing decision (locked):** pilot A$300/mo, first month free. Self-serve ladder (research pointed ~A$199/A$599, see T8/competitor research) is **deferred until pilot interest signals demand** — do NOT recreate the high tiers.

**Founder-gated, NOT your work** (leave these for the founder): sending real pilot emails (#804), the legal review sign-off (#805), Hive go-live ops (rate confirm + auto-recharge + CWS publish, #808), and setting the self-serve prices.

---

## 2. Prioritised next features to BUILD

### P1 — Scam-Ad Observatory (portfolio stream 4)
**Why:** mostly already built (the extension ships a dark Facebook ad-scanning path, `WXT_FACEBOOK_ADS`, with a Hive `analyze-ad` backend that now works post-#816/#819). Same buyer as Brand Monitor; statutory anchor in the draft SPF Digital Platforms Code (ad review). Farms scam-ad telemetry nobody else publishes in AU.
**Build:**
1. Verify the ad-scan verdict path persists server-side with **brand tagging** (grep `analyze-ad`, `WXT_FACEBOOK_ADS`; check it writes to `deepfake_detections`/`scam_reports`/`cost_telemetry` with the impersonated brand). Add the minimal persistence + `logCost` if there's a gap — otherwise the flywheel farms nothing.
2. Add a **"Scam Ads in Australia" section** to the monthly clone-watch report (reuse the report-card pipeline; n≥5 honesty floor per the monthly-report convention).
3. Ad-impersonation alerts become a Brand Monitor add-on (same funnel as the composer) — link via the brand-convergence Seam ([[brand-convergence-seam]]).
**Gate:** user-initiated in-page checks only. **Do a Meta ToS / Ad Library licence check before ANY automated ad-library harvesting** (open a research ticket — see the T2 licence-check pattern).

### P2 — Extension image-check activation prep (portfolio stream 3)
**Why:** the Hive backend is done + verified; the blocker to revenue is distribution + one telemetry gap.
**Build (the one code item):** persist the extension free-tier **daily-limit 429s** — currently Upstash-only with 48h TTL, invisible. Add one always-ship `log`/`logCost(units)` on the 429 branch in `apps/web/app/api/extension/_lib/auth.ts`. This is the ONLY leading indicator of Pro conversion and is uninstrumented (T4 finding).
**Everything else is founder/ops** (#808): confirm the Hive per-image rate vs the US$0.003 in `cost-telemetry.ts`, enable auto-recharge, flip `NEXT_PUBLIC_FF_IMAGE_CHECK`, build + publish CWS v1.1.0, make the listing public.

### P3 — Brand Monitor Wave 3 paid dashboard (gated on first pilot conversion)
**Why:** when a pilot says yes, they should get a dashboard, not just emails. This is Wave 3 of the enforcement plan.
**Build:** the `/brand/dashboard` monitored-brand view (per `clone-watch-enforcement-and-monetisation.md` §Wave 3) — the brand's dossier (clones, campaign linkage, weaponisation timeline, takedown status), gated by the `org_id` JWT claim (F1 — verify it's confirmed before RLS-scoped brand data). Wire the self-serve checkout (`/api/brand/checkout` exists, #814) **once the self-serve prices are set** — until then it stays inert. Blocked on: F1 org-JWT claim + a pricing decision.
**Note:** the first pilot uses `brand_pilot` **manual** billing — the dashboard is valuable but not blocking the first sale.

### P4 — Security-scanner SaaS (portfolio stream 6)
**Why:** cleanest unencumbered IP in the repo (`packages/extension-audit`, `packages/mcp-audit`); MCP/AI-skill auditing is a timely, uncrowded niche. Currently free + anonymous.
**Build:** productise — accounts/quotas on `/api/extension-audit` + `/api/mcp-audit`, a shareable report/badge artifact, a freemium tier. **Get any demand signal first** (it has none) — consider a lightweight "email me the full report" gate before investing.

### P5 — Mobile Premium (portfolio stream 7) — LOWEST, gated
**Why last:** the app has never been submitted to any store (T7). Everything is gated on a Play Store submission.
**Build (only if pursued):** Play submission prerequisites first — a mobile section in the privacy policy (there is none), the `QUERY_ALL_PACKAGES` Permissions Declaration (device-security use case is permitted), the data-safety form. Then port the extension's account-link + tier-enforcement pattern (#785–#788) for a `mobile_premium` SKU; add an FP-reduction layer to the Android permission scanner. **Per-device permission-intel for banks stays red-lined** (map rule + Play User Data policy + Privacy Act).

---

## 3. Open bug/quality issues (independent of the above)

- **#772** — clone-watch `.au` candidate source: `FF_CLONE_WATCH_AU_REGISTRANT` has no input (CT firehose empirically dead — read ADR-0016's 2026-07-17 amendment before re-litigating).
- **#737** — `reddit_intel_weekly_digest` has 0 rows despite the flag ON (weekly synthesis not persisting).
- **#738** — weekly-blog cron retired, produced nothing since 2026-05-02.

---

## 4. Recommended sequence for the new context

1. **Start with P1 (Scam-Ad Observatory)** — highest leverage, mostly built, same buyer, SPF-aligned. Begin by grepping the `analyze-ad`/`WXT_FACEBOOK_ADS` path to establish exactly what persists today.
2. Then **P2's 429-instrumentation** (a small, high-value PR).
3. **P3 (Wave 3 dashboard)** when the founder lands a pilot / sets self-serve pricing.
4. P4/P5 are demand- and distribution-gated — don't invest ahead of signal.

**Conventions to honour:** the ship workflow in root `CLAUDE.md` (fresh branch, explicit staging, migrations via MCP, advisors, `[build]` marker for env-only changes), the feature-integration + telemetry principle ([[feature-integration-telemetry-principle]]), and — for any multi-stage background pipeline — the operational-review rule (grep each downstream read-gate against the upstream write; docs/inngest-brakes.md for any new fn).
