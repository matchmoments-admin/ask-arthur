# Clone-Watch — Netcraft false-negative auto-escalation ("force the report through")

> **STATUS: IMPLEMENTED — PR1 (detect-only, dry-run), 2026-07-09.** Verified by a
> 6-agent ultracode review (`wf_2456a6a1-1aa`) that caught 5 silent-breakers now
> fixed in code. Corrections applied vs the original plan below:
>
> - **Endpoint is `POST /submission/{uuid}/report_issue`**, NOT `/issue` (`/issue`
>   404s silently). _(C1)_
> - **Migration is v215**, not v212 (v212–v214 taken by competitor-intel work). _(C2)_
> - Issue state persists under the **sibling key `submitted_to.netcraft_issue`**
>   (NOT `netcraft` — `merge_clone_alert_submission` replaces the whole key). _(C3)_
> - `/urls` is **paginated (default 25)** → fetched with `?count=500`. _(C4)_
> - Dry-run default via **`readStringEnv(...) !== "false"`** (not `readBoolEnv`, which
>   would deploy LIVE). Dry-run does zero POSTs AND zero DB writes. _(C5)_
> - POST and stamp are **separate Inngest steps** + `singleton` + `concurrency:1`. _(C6/C7)_
> - Per-alert `netcraft_issue` stamp is the primary idempotency guard. _(C8)_
> - Robust punycode/www/port hostname matching. _(C9)_
> - **`no threats` only at go-live**; `unavailable` deferred to PR3 (screenshot-backed). _(5.7)_
> - Submission-level poll re-enable **dropped** (rollup bug). _(C13)_
>
> **Real-data proof (smoke test, fixture `netcraft-acDb-urls.json`):** submission
> `acDb` reports `state=malicious` but `state_counts.urls={malicious:1, no threats:23,
unavailable:14}` — 37/38 URLs never actioned. The detector catches the founder's
> own examples (`googlu.co`, `facebookk.xyz`, `statestreetcollective.shop`) at
> `no threats`, ignores the 1 malicious URL, and gates `unavailable`.
>
> Full verified spec: workflow output (see the review synthesis). Files: migration
> v215, `clone-watch-netcraft-issue.ts`, `netcraft-urls.ts`, `netcraft-issue-report.ts`,
> `netcraft-results-data.ts`, `/admin/netcraft-results`, `cloneWatchNetcraftIssue.test.ts`.

**Status:** Plan (drafted 2026-07-09; keyless + per-URL model live-verified)
**Owner surface:** clone-watch / Netcraft outreach
**Trigger:** Netcraft grades on **live** content, so branded lookalikes that are parked /
cloaked / pre-weaponisation at scan time are not actioned. We want to automatically
detect those and push back via the Report API's **"Report an issue with a submission"**
endpoint (`POST /api/v3/submission/{uuid}/issue`) to force a re-look.

Relates to: `docs/plans/clone-watch-enforcement-and-monetisation.md` (Wave 0 fixed the
submission-level `no threats` → `declined` map, #682), memory
`clone-watch-enforcement-monetisation-plan`.

---

## 0. Two findings that shape the whole design (live-verified 2026-07-09)

### 0a. The API is keyless — no credential, no blocker

`GET /api/v3/submission/{uuid}` and `/submission/{uuid}/urls` both return **HTTP 200 with
no `Authorization` header** (tested against our own real submission UUIDs `gKRu…`,
`acDb…`). Submissions are email-identified; the UUID is the capability. The
`POST …/issue` endpoint mirrors the public "report an issue" link in every result email
(`/submission/{uuid}?reporting_issue=true`) — also keyless. **`NETCRAFT_REPORT_API_KEY`
is not required** for any part of this feature (it only ever added leaderboard
attribution). The poll function's `if (!apiKey) skip` was defensive, not an API
constraint.

### 0b. False negatives hide _inside_ batches marked "malicious"

The submission-level `state` is a **rollup** — it reads `malicious` if _any_ URL in the
batch is malicious. Our bulk submitter sends ≤50 URLs under one UUID, so a batch is
almost always "malicious" overall (hence every daily email says "malicious"). But
`/submission/{uuid}/urls` returns **per-URL `url_state`**, and the branded lookalikes we
care about are frequently `no threats` or `unavailable` _within_ that malicious batch —
invisible to the email and to any submission-level read.

Live proof: `acDb…` (email said "malicious") contains `inistagram.ir` = **`unavailable`**
among 38 URLs; `gKRu…` contains a mix. **Detection must be per-URL, off `/urls`.** This is
the crux of the feature and why nothing surfaces it today.

Per-URL `url_state` values (Netcraft v3): `processing`, `no threats`, `unavailable`,
`suspicious`, `malicious`.

- `malicious` → actioned ✅ (no issue).
- `no threats` → declined — **false negative if branded.**
- `unavailable` → couldn't fetch (parked/cloaked) — **not actioned; the founder's exact
  case** (googlu.co / facebookk.xyz parked). Legitimate to escalate ("branded lookalike,
  appears parked/cloaking, please re-review").
- `suspicious` / `processing` → not settled → wait, do not file yet.

### 0c. The issue request body (schema confirmed)

```jsonc
{
  "additional_info": "…free-text context (≤10000 chars)…",
  "url_misclassifications": [
    {
      "reason": "branded lookalike of <brand>; …",
      "url": "http://example.com",
      "screenshot": { "base64": "…", "ext": "png" },
    }, // screenshot optional
  ],
}
```

`url_misclassifications` items are `{ reason: string, url: string, screenshot?: {base64,
ext} }`. `additional_info` alone is valid (400 spec: misclassifications _and/or_
additional_info). v1 sends `url_misclassifications` (reason + url) + a short
`additional_info`; screenshots (from urlscan) are a v1.1 enrichment.

---

## 1. Design — one self-contained, keyless daily function

Goal: **simple, efficient, scalable, fully automated.** One Inngest function owns
detect→file, grouped by submission UUID. No API key, no email parsing, no new table.

```
clone-watch-netcraft-issue  (cron, daily ~11:00 UTC — after the 09:30 submit batch settles)
  │
  1. RPC list_clone_alerts_pending_netcraft_issue(p_max_age_days=14, p_limit)
  │     → our branded, non-FP, submitted, not-yet-issue-reported alerts + their netcraft_uuid
  │
  2. group alerts by netcraft_uuid            ← bulk batch = 1 uuid → 1 GET + 1 POST
  │
  for each uuid (bounded by daily cap):
  │   3. GET /submission/{uuid}/urls          ← keyless; per-URL truth
  │        skip uuid if is_archived=1 (issue endpoint 404s) or has_issues=1 (already filed)
  │   4. match our branded alerts → their /urls entry by hostname
  │        candidate = url_state ∈ {no threats, unavailable}  (settled, branded, not FP)
  │   5. if candidates:
  │        POST /submission/{uuid}/issue { url_misclassifications:[{reason,url}], additional_info }
  │        (DRY-RUN mode: log the exact payload, do NOT POST — canary window)
  │   6. persist per alert: submitted_to.netcraft.{issue_reported_at, issue_url_state}
  │        + logEnforcementEvent("issue_reported")  (always-ship Axiom .warn)
  │   404 archived → stamp issue_skipped_archived (permanent skip); non-2xx → $0 diag, no throw
  │
  7. logCost(feature="shopfront_clone_netcraft_issue", provider="netcraft", units=filed, $0)
```

### Why this shape

- **Self-contained** — folds detection + action; does not depend on re-enabling the
  submission-level poll (that stays as-is for the takedown KPI). Fewer moving parts.
- **Grouped by UUID** — one `GET /urls` + one `POST /issue` per submission _batch_,
  regardless of how many URLs it holds. Calls scale with submissions/day (a handful), not
  URLs (hundreds). This is the scalability lever.
- **DB = "what we submitted & care about"; Netcraft = "current verdict."** The RPC returns
  our candidate set; the function fetches Netcraft truth live and decides. No stale
  per-URL state stored.

### Detection predicate (per URL)

Branded lookalike we submitted, matched to its `/urls` entry, where:
`url_state ∈ {no threats, unavailable}` AND `!isFpBrand(brand)` AND submission
`is_archived=0` AND `has_issues=0` AND no `issue_reported_at` on our side.

### Idempotency (never double-file)

Two independent guards: (a) Netcraft's own `has_issues` flag on the submission → skip;
(b) our per-alert `issue_reported_at` stamp. Stamp is written inside the same Inngest
step as the POST so a replay short-circuits. One issue per UUID even across reruns.

### Safety rails (lean, mirrors enforcement-execute)

- **Gate:** `FF_CLONE_NETCRAFT_ISSUE` (default OFF), under `FF_SHOPFRONT_CLONE_OUTREACH`.
- **Dry-run canary:** `NETCRAFT_ISSUE_DRY_RUN` (default true) — logs the exact payload +
  candidates without POSTing, for the first few days. Flip to false to go live. (No email
  canary needed; this is an API POST.)
- **Brake:** `feature_brakes.clone_netcraft_issue` kill-switch (`isFeatureBraked`).
- **Cap:** `NETCRAFT_ISSUE_DAILY_CAP` (default 20 UUIDs/day). Reporter standing is finite;
  20 batches/day is far above real volume (~1 batch/day) yet bounds a runaway.
- **PII:** `stripUrlPii` on every URL before it leaves us.

---

## 2. Observability (Axiom + cost) — explicit, per CLAUDE.md

- **Axiom (gated `FF_AXIOM_ENABLED`):**
  - `logEnforcementEvent("issue_reported", …)` — **always-ship `.warn`** (rare,
    audit-critical; bypasses the 10% INFO sampling). One line per UUID filed, with
    `{uuid, alertIds, brands, urlCount, dryRun, runId}`.
  - The function runs under `withAxiomLogging({ fnId: "shopfront-clone-netcraft-issue" })`
    like every sibling — fn start/finish/error captured on the sampled INFO path.
  - Per-URL match detail stays **summary-only** (counts), not one line per URL, so a
    38-URL batch is a couple of log lines, not 38. Keeps Axiom volume flat as batches grow.
- **cost_telemetry:** one `logCost({feature:"shopfront_clone_netcraft_issue",
provider:"netcraft", operation:"issue_report", units:<filed>, unitCostUsd:0})` per run —
  keyless/free, but `units` keeps volume + the daily cap visible on `/admin/costs`. Errors
  → `feature:"shopfront-clone-netcraft-issue-error"` $0 diagnostic (surfaces in the daily
  digest without throwing / paging the fleet).
- **Admin visibility (read-only):** a small `/admin/netcraft-results` panel (or a section
  on the existing clone-watch admin) listing recently-filed issues + pending candidates,
  sourced from the RPC — so the founder can watch the automation during the dry-run window
  and after. Not a gate; observation only.

## 3. Realistic automation cost

| Line item                            | Volume                                                 | Cost                                    |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| Netcraft `GET /urls` + `POST /issue` | ~1 batch/day → ~2 keyless calls/day (cap 20)           | **A$0** (keyless, free)                 |
| Inngest executions                   | 1 daily cron + steps → ~30–60/mo                       | negligible (well within plan)           |
| Axiom log volume                     | a few always-ship `.warn` lines/day + sampled fn spans | **~0** of the 400 GB/mo budget          |
| AI / paid API                        | none — payload is templated, no LLM                    | **A$0**                                 |
| Supabase                             | 1 RPC/day + JSONB merges on `shopfront_clone_alerts`   | negligible (not a hot-table bulk write) |

**Steady-state ≈ A$0/mo.** The only real "cost" is Netcraft reporter standing — bounded by
the cap + brake + branded-only predicate + dry-run canary. No new index on a hot table (we
read via a bounded RPC, write small JSONB fragments).

## 4. Scalability

- Work scales with **submissions/day**, not URLs — grouped-by-UUID keeps it one GET + one
  POST per batch. 10× the watchlist → same call count, just fuller batches.
- Daily cap + `p_limit` bound worst case; a backlog drains over days, never floods.
- No LLM, no fan-out per URL, no hot-table index. Adding brands/regions doesn't change the
  function's shape.

---

## 5. Build sequence (PRs) — all dark, each shippable

- **PR 1 — engine, dry-run.** Migration **v212**
  (`list_clone_alerts_pending_netcraft_issue` RPC; optional `count_todays_netcraft_issues`).
  New `clone-watch-netcraft-issue` Inngest fn (cron + manual-trigger) in **DRY-RUN** mode:
  fetch `/urls`, match, build payloads, **log** them, stamp nothing to Netcraft. Add
  `FF_CLONE_NETCRAFT_ISSUE` + `feature_brakes.clone_netcraft_issue` + env
  (`NETCRAFT_ISSUE_DRY_RUN`, `NETCRAFT_ISSUE_DAILY_CAP`). Add `"issue_reported"` to
  `EnforcementEvent`. Register fn in `apps/web/app/api/inngest/route.ts`. Read-only admin
  visibility panel. Ship + let a real day's batch flow → eyeball the payloads.
- **PR 2 — go live.** Flip `NETCRAFT_ISSUE_DRY_RUN=false` behind the flag; the fn now
  POSTs. Confirm one real issue lands (Netcraft `has_issues` flips to 1; issue visible on
  the submission page). This is the fully-automated state — no human in the loop.
- **PR 3 (enrichment, optional).** Attach urlscan screenshots to `url_misclassifications`
  (`{base64, ext}`); optionally re-enable the submission-level poll cron for the
  time-to-takedown KPI (shares the keyless GET).

## 6. Verification

- **Live GET already confirmed keyless (2026-07-09).** One manual `POST …/issue` against a
  real declined UUID during PR 1 review confirms the 200 shape + that `has_issues` flips.
- `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts` after v212 (function-body bites).
- Unit tests: per-URL predicate (`no threats`/`unavailable` branded → candidate; malicious/
  suspicious/processing → not), UUID grouping (N alerts → 1 issue), hostname matching,
  `is_archived`/`has_issues` skips, CLAIM-then-file idempotency, cap arithmetic, dry-run
  emits payload but no fetch.
- Re-run `mcp__supabase__get_advisors` (security + performance) after v212.

## 7. Decisions folded in (from founder, 2026-07-09)

1. **All submissions are automated** (never by hand) → **no email ingestion.** Poll/GET
   over stored UUIDs covers 100%.
2. **No API key needed** → keyless throughout; `NETCRAFT_REPORT_API_KEY` stays optional.
3. **Fully automate** → target state is the auto fn; dry-run canary is the only "human
   moment," and only for the first few days.

## 8. Open (resolve during PR 1)

- Include `unavailable` as a false-negative trigger (recommended — it's the founder's
  parked/cloaked case) vs `no threats` only. Start with both; the dry-run payloads will
  show if `unavailable` is too noisy.
- Whether issue reports should also decrement the shared `CLONE_SUBMISSION_DAILY_CAP` or
  only the dedicated `NETCRAFT_ISSUE_DAILY_CAP`. Default: dedicated cap (distinct action),
  honour the shared brake.
- `additional_info` wording — keep factual + evidentiary (brand, detection method,
  hosting/registrar) to protect reporter standing.
