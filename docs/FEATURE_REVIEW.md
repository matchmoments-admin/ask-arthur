# Feature Planning Review — Critical Assessment

## Context

The user provided a 10-section feature planning document. This review validates each section against what's actually built, assesses what's genuinely needed vs. scope creep, and produces a prioritised action list.

---

## Critical Assessment by Section

### Section 1: FLS Fix — KEEP (P0)

**Verdict: Essential. Build it.**

The codebase stores confidence (0-1) but doesn't act on it. There's no user feedback mechanism and no sender whitelist. These are genuine trust issues.

**What to build:**
- Add `verdict_feedback` table (user reports false positive/negative)
- Add confidence threshold: <0.6 → "Uncertain" verdict instead of binary
- Add Australian sender whitelist (ATO, Scamwatch, banks, telcos) — ~50 entries
- API endpoint: `POST /api/feedback` storing user corrections
- Display confidence prominently in ResultCard

**What NOT to build:**
- Skip the Hugging Face benchmark — our data is Australian-specific, generic phishing datasets won't help
- Skip "fine-tuning" — prompt engineering is working, fine-tuning is premature

**Effort: 3-4 days**

---

### Section 2: Dashboard & Data Refinement — MOSTLY DONE

**Verdict: 85% already built. Fill gaps only.**

The audit shows 8 dashboard components exist, charts work, indexes deployed, `get_dashboard_summary()` RPC live. The plan asks for things that already exist.

**What's actually missing:**
- Risk score histogram (not built, useful for model drift detection)
- Entity frequency table (top 20 reported this week — not built)
- False positive rate tracker (depends on Section 1 feedback table)
- Geographic heatmap — **SKIP**. PostGIS + Leaflet.js for a handful of data points is over-engineered. The existing region field in check_stats is sufficient.

**What NOT to build:**
- Pie/donut charts for scam types — horizontal bars already exist and are better
- B2B API usage chart — api_usage_log has 0 rows, no data to chart yet
- pgTAP test suite — nice to have but doesn't ship product features

**Effort: 2-3 days for the gaps**

---

### Section 3: Scam Feed Summary — KEEP (P1)

**Verdict: Valuable differentiator. Build a lean version.**

Auto-generated "Scam Digest" after each scrape is a great idea. But the plan over-engineers it.

**What to build:**
- Inngest function: after scrape, query new feed_items, call Claude for 3-sentence summary
- Store in `feed_summaries` table (scrape_date, summary_text, stats_json)
- Show as a banner card at top of /scam-feed page
- No push notifications for spikes yet (premature — we don't have enough users)

**What NOT to build:**
- Donut chart per digest — the horizontal bar chart already covers this
- Claude "confidence-weighted narrative" — keep it simple, 3 sentences
- `/api/feed/latest-summary` endpoint — just query the table directly in the page

**Effort: 2 days**

---

### Section 4: Persona Checker — DEFER (P2/P3)

**Verdict: Big feature, not needed yet. Defer to Wave 3.**

This is a 20+ day build across 12 sub-features. The core scam checker already handles romance and employment scams via the existing Claude prompt. Adding a dedicated persona flow is a significant product expansion that should come after the core product is stable and monetised.

**What to defer entirely:**
- Context inference engine — Claude already classifies scam type
- Resume/credential analysis — niche use case
- Video call deepfake analysis — deepfake-detect.ts exists for audio already
- Reddit cross-reference — low signal-to-noise ratio
- SerpAPI reverse image search — expensive, privacy concerns

**What might be worth keeping (later):**
- "Was this person real?" simple checker — paste a profile URL, get a verdict
- But this is essentially the existing text analysis with a different UI wrapper

**Effort if built: 20+ days. Recommendation: defer until after revenue.**

---

### Section 5: Feed Scams as Tool Ideas — SKIP

**Verdict: Internal tooling, not a user feature. Not worth building.**

A `tool_opportunity_flags` table that auto-suggests product ideas based on scam patterns is clever but premature. The team is small — you already know what to build next from looking at the data. This is a process tool, not a product feature.

**Recommendation: Delete from roadmap. Use the scam feed manually to spot trends.**

---

### Section 6: Computer & Network Scanner — SKIP

**Verdict: Out of scope. Not Arthur's core competency.**

The site-audit package does web security scanning. Adding Shodan API, port scanning, router checks is a completely different product category. It would confuse the value proposition ("Is Arthur a scam checker or a pentesting tool?").

**What already exists that covers the gap:**
- Site audit: SSL/TLS, headers, CSP, DMARC/SPF/DKIM
- Extension audit: Chrome extension security scanning
- These are sufficient for Arthur's positioning

**Recommendation: Delete from roadmap entirely.**

---

### Section 7: Additional Feature Ideas — CHERRY-PICK

**7.1 Deepfake Voice Detector — ALREADY BUILT**
- `deepfake-detect.ts` exists with Reality Defender + Resemble AI
- Just needs API keys set and feature flag enabled
- **Effort: 0 days (config only)**

**7.2 Phishing Email Forensics — PARTIAL OVERLAP**
- Email header parsing overlaps with site-audit's SPF/DKIM checks
- The Chrome extension already scans Gmail
- A standalone .eml upload tool could be useful but is P3
- **Recommendation: Defer**

**7.3 Crypto Wallet Checker — NEARLY DONE**
- `scam_crypto_wallets` table exists with 7 entries
- Missing: public lookup API endpoint
- **Effort: 0.5 days — add `/api/v1/threats/wallets/lookup` route**

**7.4 Scam Simulator — SKIP**
- Fun but doesn't drive revenue or authority
- Better served by blog content (which already auto-generates weekly)

**7.5 Business Impersonation Monitor — KEEP (P2)**
- CT monitoring already exists
- Adding business self-registration is a strong B2B hook
- **Effort: 2-3 days**

---

### Section 8: Claude Agent vs API — NO CHANGE NEEDED

**Verdict: Current API architecture is correct. Don't switch.**

The document correctly concludes with "hybrid" but the practical recommendation is: keep the fast single-call API for everything. The enrichment pipeline (Inngest) already provides multi-step analysis — it's just not done by Claude.

**What NOT to do:**
- Don't add Claude tool use / agent loops for standard checks
- Don't add Claude Agent SDK — unnecessary complexity
- Don't fine-tune — prompt engineering is working

**Recommendation: No action required.**

---

### Section 9: QR Code Click-Through — KEEP (P1)

**Verdict: Good UX improvement. Build it.**

The QR scanner works but currently just runs analysis. The three-tier warning modal (safe/uncertain/high-risk) with click-through logging is a genuine UX improvement.

**What to build:**
- Warning modal with three severity levels
- "Proceed anyway" button for uncertain/high-risk (requires deliberate tap)
- Log `user_chose_to_proceed` in scam_reports
- Post-visit feedback prompt ("Did anything suspicious happen?")

**What NOT to build:**
- Legal copy review — just use probabilistic language ("likely", "may be")

**Effort: 2-3 days**

---

## Recommended Roadmap (Filtered)

### Wave 1 — Fixes (Week 1-2)

| Item | Effort | Source |
|------|--------|--------|
| FLS: confidence threshold + "Uncertain" verdict | 1 day | S1 |
| FLS: verdict_feedback table + API | 1 day | S1 |
| FLS: Australian sender whitelist (50 entries) | 0.5 day | S1 |
| QR: three-tier warning modal + click-through logging | 2 days | S9 |
| Dashboard: entity frequency table (top 20 this week) | 1 day | S2 |

### Wave 2 — Intelligence (Week 3-5)

| Item | Effort | Source |
|------|--------|--------|
| Feed summary: Inngest digest after scrape + banner card | 2 days | S3 |
| Crypto wallet lookup endpoint | 0.5 day | S7.3 |
| Enable deepfake detection (config only) | 0 days | S7.1 |
| Business impersonation self-registration | 2 days | S7.5 |
| Dashboard: false positive rate tracker | 1 day | S2 |

### Wave 3 — Later (Month 2+)

| Item | Effort | Source |
|------|--------|--------|
| Persona Checker MVP (simple "is this person real?" flow) | 5-7 days | S4 |
| Phishing email .eml upload tool | 2-3 days | S7.2 |

### Explicitly Removed

| Item | Reason |
|------|--------|
| Network/computer scanner (S6) | Out of scope — not Arthur's product |
| Feed scams as tool ideas (S5) | Internal process, not product feature |
| Scam simulator (S7.4) | Fun but no revenue impact |
| Claude Agent SDK (S8) | Current API is correct |
| Geographic heatmap with PostGIS (S2) | Over-engineered for current data volume |
| pgTAP test suite (S2) | Doesn't ship features |
| Fine-tuning Claude (S8) | Premature — prompt engineering working |

---

## Files to Create/Modify

### Wave 1
| File | Purpose |
|------|---------|
| `supabase/migration-v47-feedback.sql` | verdict_feedback table |
| `apps/web/app/api/feedback/route.ts` | User false positive reporting |
| `packages/scam-engine/src/claude.ts` | Add confidence threshold, "Uncertain" verdict |
| `packages/scam-engine/src/sender-whitelist.ts` | Australian legitimate sender list |
| `apps/web/components/QrWarningModal.tsx` | Three-tier warning modal |
| `apps/web/components/dashboard/EntityFrequency.tsx` | Top 20 entities widget |

### Wave 2
| File | Purpose |
|------|---------|
| `packages/scam-engine/src/inngest/feed-digest.ts` | Post-scrape summary generator |
| `supabase/migration-v48-feed-summaries.sql` | feed_summaries table |
| `apps/web/app/api/v1/threats/wallets/lookup/route.ts` | Crypto wallet lookup |
| `apps/web/components/dashboard/FalsePositiveTracker.tsx` | FP rate chart |

---

## Verification

1. `pnpm turbo build` passes
2. Submit known legitimate ATO message → should return "Uncertain" or "Safe"
3. Submit known scam → should return "High Risk" with high confidence
4. Scan QR code → see appropriate warning tier
5. Dashboard shows entity frequency table
6. Feed summary appears on /scam-feed after scrape runs
