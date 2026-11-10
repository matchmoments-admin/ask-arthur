# Data-residency remediation plan

**Created:** 2026-07-30
**Trigger:** PR #876 found that five documents claimed Australian data residency the infrastructure does not provide.
**Status:** awaiting decision on Track A / B / C.

---

## 1. What is actually true (measured 2026-07-30, not inferred)

| Layer                      | Reality                        | Evidence                                                                             |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| Database                   | **Singapore** `ap-southeast-1` | Supabase API: one project, `region: ap-southeast-1`. Never in Sydney.                |
| Server functions (compute) | **US East** `iad1`             | `x-vercel-id: syd1::iad1::…` on 4/4 sampled requests. Format is `<edge>::<compute>`. |
| CDN / static edge          | Sydney `syd1`                  | Same header, first segment. Cached pages never leave AU.                             |
| Cache / rate limit         | Singapore `ap-southeast-1`     | Upstash config (already documented correctly).                                       |
| Object storage             | Oceania hint                   | Cloudflare R2.                                                                       |
| AI analysis                | **US**                         | `new Anthropic()` — direct Anthropic API, `packages/scam-engine/src/claude.ts:395`.  |

**Net position: stored in Singapore, processed in the United States.** Australian infrastructure is limited to the CDN edge and the R2 location hint.

### Measured cost of the geography (from Sydney)

| Request type                                                             | TTFB                             |
| ------------------------------------------------------------------------ | -------------------------------- |
| Dynamic route (`/api/stats`) — Sydney edge → iad1 compute → Singapore DB | **660–1,214 ms** (median ~1.1 s) |
| Edge-cached page (`/`) — no compute                                      | **111–124 ms**                   |
| TCP connect to edge                                                      | 15–37 ms                         |

So roughly **one second per dynamic request is pure geography**: a trans-Pacific hop from the Sydney edge to US compute, then a second trans-Pacific hop from US compute to the Singapore database. Every logged-in page view and every scam check pays it twice.

---

## 2. The three claims, and what each actually requires

The documents made three separable claims. They are not equally fixable, and conflating them is what produced the mess.

| Claim                     | Fixable?                 | Requires                                 |
| ------------------------- | ------------------------ | ---------------------------------------- |
| "Processed in Australia"  | **Yes — today, ~1 hour** | Track A: one `vercel.json` key           |
| "Stored in Australia"     | Yes, but a real project  | Track B: Supabase region migration       |
| "Zero US data dependency" | **No, as architected**   | Track C, or retire the claim permanently |

**The third one matters most and is the one to internalise.** Claude is the analysis engine and Anthropic's API is US-based. No amount of region configuration changes that. Any document claiming zero US data dependency is false today and will stay false until the AI call itself moves (Track C). That claim should be retired regardless of which track is chosen.

---

## 3. Track A — move compute to Sydney (recommended, do first)

**Change:** add `"regions": ["syd1"]` to `apps/web/vercel.json`.

**Why it is genuinely easy:**

- Vercel plan is **Pro** (verified via API) — `syd1` is available; region selection is not Enterprise-gated. Only `functionFailoverRegions` is.
- The project currently has **no** `regions` key, which is why it defaults to `iad1`. There is nothing to unpick.
- **No code assumes a region.** Grepped `apps/web` and `packages` for `iad1` / `us-east` / `VERCEL_REGION ===`: the only hits are the doc strings PR #876 just corrected.
- Instantly reversible — delete the key and redeploy.

**Expected effect:** removes one trans-Pacific hop from every dynamic request, and cuts DB round-trip time from ~235 ms (iad1→Singapore) to ~95 ms (syd1→Singapore). On a route making several sequential queries this compounds. Expect dynamic TTFB to drop from ~1.1 s toward ~250–350 ms.

**The one trade-off, stated honestly:** the Claude call goes from same-continent to trans-Pacific, adding ~200 ms _once_ per analyse. Against a multi-second Claude call inside a 15 s/25 s timeout and a 60 s `maxDuration`, that is noise. Everything else gets faster.

**Verification:** `x-vercel-id` must read `syd1::syd1::…`, then re-measure TTFB, then re-run the cron smoke checks (20 crons move region too — they get faster, same DB).

**Residual risk:** low. Worst case is a cold-start profile change in a region with less capacity; reverted by deleting one line.

---

## 4. Track B — move the database to Sydney (`ap-southeast-2`)

**There is no in-place region change in Supabase.** This is a migrate-to-a-new-project exercise.

**Migration surface (measured):**

| Item                    | Count / size                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Total database          | **2,390 MB**                                                                                                |
| Tables                  | 159                                                                                                         |
| Functions (PL/pgSQL)    | 177                                                                                                         |
| RLS policies            | 148                                                                                                         |
| Views                   | 20                                                                                                          |
| Triggers (non-internal) | 16                                                                                                          |
| Extensions              | 8 — `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `pgmq`, `plpgsql`, `supabase_vault`, `uuid-ossp`, `vector` |
| Vault secrets           | **0** ← the one blocker that is _not_ present                                                               |

All eight extensions are available in any Supabase region, and Vault being empty removes the hardest part (Vault secrets do not dump portably).

**What makes it non-trivial anyway:**

1. Every service-role key, anon key and connection string changes — Vercel (3 environments), Inngest, GitHub Actions secrets, the Cloudflare email Worker, the Python scrapers' `SUPABASE_DB_URL`.
2. 259 migration files must be replayed or the dump restored wholesale; the prod ledger has 223 rows and six migrations exist in prod with no file, so a schema-only replay would _lose_ those objects. Restore from dump, not from migrations.
3. Feature-flag and cron state lives in the DB (`feature_brakes`, partition children) — needs the data, not just the schema.
4. 499 MB HNSW index on `acnc_charity_embeddings` will need rebuilding; plan for it in the window rather than being surprised.

**Realistic shape:** a scheduled maintenance window. Dump/restore of 2.4 GB is ~20–40 minutes; verification, key rotation and smoke tests dominate. Budget **half a day**, with a documented rollback (keep the Singapore project live and read-only until sign-off). Near-zero-downtime via logical replication is possible but materially more complex and not warranted at 0.75 checks/day.

**Recommendation: schedule separately, do not bundle with Track A.** Track A is a config flip; Track B is a data migration. Shipping them together makes a rollback ambiguous.

---

## 5. Track C — move AI processing to Australia (the only route to a true sovereignty claim)

Claude is available in **AWS Bedrock `ap-southeast-2` (Sydney)**. Switching the analysis call from the direct Anthropic API to Bedrock-in-Sydney would keep the actual content analysis onshore.

**What it involves:** swap `new Anthropic()` (`claude.ts:395`) for the Bedrock client (`@anthropic-ai/bedrock-sdk`), add AWS credentials, and re-map model IDs (Bedrock uses its own identifiers, and Haiku/Sonnet availability differs by region — must be confirmed for `ap-southeast-2` before committing).

**Cost/benefit:** this is the difference between "we disclose overseas processing" and "your scam report never leaves Australia" — which is the actual sovereignty pitch, and the thing a bank or regulator would test. But it is a real re-integration of the hot path, needs its own prompt-regression run (and note the promptfoo eval has never executed — see §7), and Bedrock pricing differs.

**Recommendation:** worth doing _if_ the sovereignty positioning is commercially load-bearing. Not urgent at current demand. Do not claim it before it ships.

---

## 6. If Sydney is not achievable — the fallback

If Track A somehow regresses latency or Track B is judged too risky, the honest alternative is to **reposition the claim rather than keep an untrue one**:

- Retire "Australian-hosted", "sovereign data residency" and "zero US data dependency" outright.
- Replace with what is defensible and verifiable: **"Australian-owned and operated. Data stored in the APAC region (Singapore) under Australian Privacy Act obligations, with all overseas recipients disclosed."**
- Lean on the control that actually matters to a regulator: APP 8 compliance is about _disclosure and accountability for_ overseas recipients, not physical location. A complete, accurate sub-processor list (now shipped in PR #876) is worth more than a geography claim that does not survive a `dig`.

This is a legitimate end state, not a consolation prize — but it only works if the marketing is corrected to match, which is the part still outstanding (§7).

---

## 7. All surfaces — full inventory and state

### Fixed in PR #876 (open, green, awaiting merge)

| Surface                                       | Was                                                                                                | Now                                                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/privacy` §1–2                               | "immediately discarded. We do not retain the content you submit"                                   | Images discarded; text retained as a redacted copy, 90 d / 180 d HIGH_RISK. **55 of 81 rows carry retained content, oldest 2026-03-01** — the old wording was false. |
| `/privacy` §3                                 | 4 overseas providers                                                                               | Storage/processing locations + **all 17** recipients with the specific data each receives, plus optional-feature providers                                           |
| `/privacy` §3                                 | "Supabase (United States)"                                                                         | Singapore `ap-southeast-1`                                                                                                                                           |
| `/privacy` §7 (Shopify)                       | "Stored in Australia (Supabase Sydney region)"                                                     | Singapore, with a pointer to §3 for processing                                                                                                                       |
| `/trust`                                      | "PostgreSQL in Sydney ap-southeast-2"; "All primary data is processed and stored within Australia" | Singapore; compute `iad1` with Sydney edge called out                                                                                                                |
| `/trust/security-overview`                    | Sydney + Australian-only processing                                                                | Corrected, with a dated note recording what it used to say                                                                                                           |
| `docs/compliance/data-residency-statement.md` | Sydney DB, `syd1` hosting                                                                          | Corrected + dated correction banner                                                                                                                                  |

### Flagged but deliberately NOT rewritten (founder decision — may already be sent)

| Surface                             | Claim                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `docs/pitch/investor-outreach.md`   | "Australian-hosted (Supabase AP-Southeast, Vercel Sydney edge). No US data dependency" |
| `docs/pitch/sales-materials.md`     | "Australian-hosted" ×3                                                                 |
| `docs/pitch/executive-summary.md`   | Australian-hosted positioning                                                          |
| `docs/pitch/grant-strategy.md`      | "Shield 5: Sovereign capabilities — zero US data dependency"                           |
| `docs/grants/aea-seed-narrative.md` | "Australian-hosted with sovereign data residency"                                      |

Each now carries a dated warning banner. **If any version has gone to an investor, a customer, or the AEA grant body, that is a representation already made and needs a decision — not a silent edit.**

### Accurate already — no change needed

- Upstash Redis / Singapore, Cloudflare R2 / Oceania: correctly documented.
- **Claude receives PII-scrubbed text.** I expected raw text and was wrong: `claude.ts:403` passes `scrubPii: true`. Images are _not_ scrubbed (`scrubPII` is text-only) — now stated explicitly.
- **Images are genuinely discarded.** `FF_SCREENSHOT_RETENTION` is unset in prod → `storeVerifiedScam` gets no uploader (ADR-0010). That promise holds.

---

## 8. Recommended sequence

1. **Track A now** — `"regions": ["syd1"]`, verify `syd1::syd1`, re-measure TTFB, smoke-test the crons. ~1 hour. Delivers a large latency win _and_ makes "processed in Australia" true.
2. **Then merge PR #876** with the processing line already accurate rather than as a published retraction.
3. **Decide the marketing position** on the five pitch/grant docs — the only step I should not take unilaterally.
4. **Schedule Track B** as its own maintenance window if Australian _storage_ is commercially required.
5. **Evaluate Track C** only if sovereignty is load-bearing for a named prospect.

Ordering note: doing Track A before merging #876 means the public disclosure describes the good state. Merging #876 first is also fine and strictly better than the status quo — it just publishes a correction that Track A would then improve on a day later.

---

## 9. Related gaps this exposed (tracked, not part of this plan)

- **The promptfoo prompt-regression eval has never executed** — no `ANTHROPIC_API_KEY_EVAL` secret, and the workflow `exit 0`s without it, so every run reports green. This is the harness Track C would need to prove a Bedrock model swap is safe. Fix before attempting Track C.
- **Zero required status checks on `main`** — branch protection returns 404; every CI check is advisory. Worth fixing before a migration window.
