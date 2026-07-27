# Clone-Watch — Brand-value features ("the typosquat early-warning system")

**Status: COMPLETE (all five features shipped, 2026-07-10 → 2026-07-12).**
**F1** weaponisation alert (#707, v220, `FF_CLONE_WEAPONISED_ALERT=true` in prod
2026-07-11; routes via the `brand_contact_directory` seam — `monitored_brands`
is telemetry-tagged only, zero rows + no contact column; org-email routing is a
follow-up). **F4** evidence gate (#708, v221) + reporter LIVE
(`NETCRAFT_ISSUE_DRY_RUN=false`, cap 10/day; 12 filings, zero rejects, as of
2026-07-12). **F5** vendor-gap story shipped via the LinkedIn report outcomes
(#709/#710 + honest-arithmetic fixes; `weaponisedAfterDecline` metric). **F2**
watch-list email (#711 — lifecycle badges, still-live-first ordering, honest
timestamps, why-still-up/what-you-can-do slots). **F3** weaponisation-risk
scorer + risk-ranked recheck + reporter liveness pre-check (v222; the ONE
formula lives in `lib/clone-watch/weaponisation-risk.ts`). Recheck loop ON
since 2026-07-10.
**Origin:** the live-data research on 2026-07-10 (see below) reframed what the
clone-watch product actually _is_ for brands. This plan turns that reframe into
concrete, brand-useful features.

Follow-on to [[clone-watch-brand-story-reporting.md]] (reconciler + aggregation,
now LIVE) and the Brand Protection billing (`BRAND_PLANS`, `monitored_brands` v207).

---

## 1. The insight (grounded in production data, 2026-07-10)

After the reconciler backfill, the 752 reconciled clones cross-tabbed against our
own urlscan verdict:

| our urlscan verdict   | Netcraft took down | Netcraft declined |
| --------------------- | ------------------ | ----------------- |
| `parked_for_sale`     | 0                  | 56                |
| `neutral`             | 10                 | 492               |
| `(unscanned)`         | 10                 | 184               |
| **`likely_phishing`** | **none exist**     | **none exist**    |

Four conclusions, each of which drives a feature:

1. **Netcraft declines because there is no _evidence of a crime yet_** — it grades
   on live malicious content. Parked → 0% actioned. It (correctly, for its risk
   model) waits for a lookalike to _weaponise_ before it will act; a takedown
   without evidence is legal exposure (the itch.io wrongful-takedown problem).
2. **We should only ever escalate HIGH-CONFIDENCE clones** — i.e. urlscan-confirmed
   `likely_phishing`. We currently have zero. Escalating parked/neutral clones is
   crying wolf → declined → burns our finite Netcraft reporter standing.
3. **The unactioned lookalikes ARE the product.** 732 live lookalikes that no
   takedown vendor will touch yet, that the brand has zero visibility into. We are
   the only ones who know they exist. Telling the brand is the core value — it
   needs _neither_ the reporter nor the recheck flag.
4. **Weaponisation is the pivotal moment** — the instant a parked clone flips to
   live phishing is (a) the _evidence Netcraft was waiting for_, (b) the moment the
   brand is under active attack, and (c) the most compelling story ("Netcraft
   declined it; it became live phishing; we caught it first"). Nothing today tells
   the brand this happened — `weaponised.v1` only opens an internal case.

**The reframed product:** _We are the brand's typosquat early-warning system. We
see the lookalikes before they attack, we track the ones the takedown vendors
won't act on, and we alert the brand the moment one goes live — so they are never
blind to an impersonation attack in progress._

---

## 2. Value ladder (maps to the existing `BRAND_PLANS`)

- **Awareness (free / lead-gen):** "N lookalikes of your brand are live and
  unactioned." (already: `/brand-exposure` teaser.)
- **Monitor (paid):** the monthly Unactioned-Lookalike report **+ real-time
  weaponisation alerts + a per-clone risk score.** ← the features below.
- **Enforce (paid+):** evidence-gated escalation to Netcraft/blocklists +
  managed takedown the moment a clone weaponises.

---

## 3. Recommended features (prioritized by brand value)

### F1 — Weaponisation early-warning alert **(highest value; the killer feature)**

When a monitored brand's clone flips `declined/monitoring → weaponised`, alert the
brand **immediately** with the evidence (urlscan screenshot, live URL, hosting,
registrar + abuse contact). This is the time-sensitive brand-protection moment —
"a lookalike of you is live and phishing right now."

- **Reuses:** the recheck loop (built) → `apply_clone_urlscan_verdict` → the
  existing `CLONE_WATCH_WEAPONISED_EVENT` (`shopfront/clone.weaponised.v1`);
  `monitored_brands` (v207) for who to alert + their plan tier; the Resend + React
  Email infra; `CloneWatchBrandAlert.tsx` as the template base.
- **New:** a **brand-facing** `weaponised.v1` consumer
  (`clone-watch-notify-weaponised`) that joins the alert's `target_brand_normalized`
  → `monitored_brands` (active, plan ≥ monitor), builds the evidence block, and
  sends (four-eyes/auto per the existing notify-brand approval pattern). Gated
  `FF_CLONE_WEAPONISED_ALERT`; honours a per-brand cooldown + the STOP suppression.
- **Prereq:** `FF_SHOPFRONT_CLONE_RECHECK` ON (the loop that detects weaponisation).

### F2 — The "Unactioned Lookalike" report + live watch-list **(core monthly deliverable)**

Sharpen the monthly Brand Stewardship report into the honest, valuable artifact
the research describes: per brand — detected / **taken down** / **declined & still
live (unactioned)** / **weaponised** — plus a **watch-list of the still-up clones**
(domain + screenshot + registrar + hosting + "first seen / still live as of"), the
honest **"why is it still up?"** explainer (Netcraft's evidence threshold), and a
**"what you can do"** CTA (registrar abuse report / auDRP / or upgrade to managed
enforcement).

- **Reuses:** the aggregation + `clone_watch_report_summary` +
  `clone_watch_monthly_brand_stats` (built in the brand-story PR); the email
  "What Netcraft did with them" block; urlscan screenshots we already hold.
- **New:** the watch-list section (still-`declined` clones with evidence) + the
  "why / what-you-can-do" copy + a per-brand deep-link to the full list.

### F3 — Lookalike risk intelligence **(the differentiator; "which will weaponise")**

Learn from the taken-vs-declined pattern to score each unactioned clone's
**weaponisation risk**, so the brand knows _where to focus_ among hundreds of
still-up lookalikes. Features: registrar/TLD/hosting reputation, brand
sensitivity (bank/super > generic), lexical closeness, age, and the empirical
prior (parked → low, credential-word tokens → high). Surface "your 5
highest-risk unactioned lookalikes" in the report + prioritise the recheck
cadence on high-risk clones (faster weaponisation catch + urlscan efficiency).

- **Reuses:** existing `signals`, `attribution` (whois/hosting), the Haiku
  preclassifier `confidence`, `clone_watch_classifications`.
- **New:** a `weaponisation_risk` score (deterministic first; a model later) +
  a risk-ordered recheck worklist.

### F4 — Evidence-gated Netcraft/blocklist escalation **(fix the reporter's job)**

Re-aim the false-negative reporter so it _only_ escalates **high-confidence
evidence** — urlscan `likely_phishing` (which is exactly what Netcraft acts on).
And make it **auto re-escalate the moment a clone weaponises**, carrying the fresh
screenshot as evidence. This aligns "high confidence" + "Netcraft will act" +
"protects reporter standing" into one gate, and turns the reporter from a
standing-risk into a precision tool.

- **Reuses:** the shipped issue reporter (`clone-watch-netcraft-issue`) + its
  cap/brake/autobrake/dead-letter; `weaponised.v1`. (Correction 2026-07-10:
  `url_misclassifications[].screenshot` does NOT exist in the Netcraft payload —
  it's exactly `{reason, url}` — so evidence goes into the `reason` text as the
  urlscan result URL; an attachment field needs Netcraft API verification first.)
- **New:** a confidence gate in the reporter's predicate (require
  `urlscan_classification='likely_phishing'` OR `lifecycle_state='weaponised'`);
  a `weaponised.v1` → escalate hook. **Do NOT flip `NETCRAFT_ISSUE_DRY_RUN=false`
  until this gate lands** (today it would file low-confidence reports on parked
  clones).

#### F3/F4 — what the first three weeks in production actually taught us (2026-07-26)

F3 and F4 both shipped working and both quietly under-delivered. Of 54 alerts
that reached `weaponised`, only 17 (31%) were ever re-reported, and just ONE
filing landed in the ten days to 2026-07-26. Four causes, fixed in #852–#857
(migrations v248–v251):

1. **The F3 liveness pre-check was false-dead.** `liveness.ts` collapsed every
   `fetch` rejection into `false`, so NXDOMAIN, an expired/mismatched TLS cert,
   a timeout and a refused connect were indistinguishable. `targetshopp.cc` — a
   weaponised, urlscan-confirmed Target lookalike — was drained `dead_at_probe`
   while serving, purely because its cert has a hostname mismatch. 13 of 19
   batches died this way. The probe is now three-valued and **only NXDOMAIN
   counts as dead**; from Vercel's egress a refused connect is indistinguishable
   from a phishing kit blocking us, so DNS is the only honest test we control.
2. **`unavailable` was treated as a verdict.** It is a timing artifact —
   Netcraft grades on one fetch at submission time, and `id-apple-kc.shop` read
   `unavailable` at 10:00 and was serving phishing by 12:01 the same day. Worse,
   the drain was TERMINAL and the worklist excludes any `skipped` key, so 19
   weaponised alerts — more than had ever been filed — were locked out forever.
   Now a bounded deferral, and **escalatable on witnessed-weaponisation
   evidence**: our scan disagreeing with theirs IS the false negative.
3. **F4's outcome was unmeasurable by construction.** Both the reconcile and
   recheck worklists excluded `weaponised`, and the reconciler is the only thing
   that stamps `takedown_at` — so `re_taken_down` could never be non-zero and
   `refileToTakedown` was permanently n=0. The KPI code was already written and
   wired; it was starved, not missing.
4. **23 of 54 had no submission to escalate against** (3 never submitted, 20
   archived past the reporter's 30-day window), so `report_issue` was impossible
   and the submitter dedupes on the existing key. Addressed by the v250/v251
   re-submission lane.

5. **The new resubmit lane would have starved itself on dead rows** — caught
   pre-fire, hours before its first live run, and fixed in #861 (v252). The
   worklist rank-limits to the daily cap _before_ liveness is knowable; the
   probe runs in the caller afterwards and dead rows were filtered out of the
   batch without being stamped, so each one returned at the head of the
   ordering the next day and every day after. 9 of the 23 eligible alerts were
   NXDOMAIN on the morning of the run, projecting 6 → 3 → 2 → 1 submissions/day
   toward a steady state of 9 of 10 daily slots spent on domains that no longer
   exist — with `ok: true` returned throughout. Now: a bounded 7-day
   `dead_at_probe` deferral (the v248 shape, own key), plus an over-fetch so a
   dead-heavy batch can still fill the day's budget with live rows.

6. **And the lane would then have fired every other day** — found on day 2
   while verifying cause 5's fix, and fixed in #862 (v253). The 24h submission
   budget was a rolling window anchored on the previous run's completion, while
   the cron fires at a fixed 09:30 UTC. Day 1 stamped its rows at `09:30:52`;
   day 2's run at `09:30:00` saw them 52 seconds inside its own window, read
   `budget_remaining = 0`, and would have submitted nothing. 10 URLs per two
   days against a documented cap of 10/day. Pre-existing since v250 and carried
   unchanged through v251 and v252 — a single run is indistinguishable either
   way, so only the second consecutive day exposed it. Now per UTC day.

Five transferable lessons:

- **Never let a metric decide who gets reported.** v250 excluded already-escalated
  clones to keep a median clean; six live phishing domains lost their only path.
  Bend the metric (v251 re-anchors `fullLoop` on `netcraft.prior[0]`), not the
  enforcement.
- **A re-submit path must move the row back across the exact predicate its
  consuming stage filters on** — the v224 lesson, re-learned twice here.
- **A row the consumer skips is a row the worklist must lose.** Cause 5 is the
  same rule read from the other end: filtering in the caller is not the same as
  advancing the row, and an unstamped skip re-presents forever. Whenever a
  worklist is bounded _before_ a gate the caller applies, the gate's rejects
  need somewhere to go.
- **A periodic job must not bound itself on a rolling window it writes into.**
  Cause 6: fixed-time cron + `now() - 24h` means each run lands just inside its
  predecessor's window and cancels itself. Anchor the budget to the same period
  the schedule uses (a calendar day for a daily cron), or the cadence and the
  bound fight each other forever.
- **Correctness review cannot catch any of these.** Each stage was individually
  right. Only telemetry over days showed the loop was inert — except cause 5,
  which an operational read of the worklist-vs-probe interaction caught before
  the first run, which is the cheaper place to find it. Cause 6 is the
  counter-example that keeps the lesson honest: it was invisible until a second
  consecutive day of real runs existed, and no amount of pre-flight reading
  would have surfaced it.

### F5 — (optional, marketing) The vendor-gap data story

The "we flagged N, the takedown vendor declined X%, Y% later weaponised" narrative
is unique, honest, and compelling — a LinkedIn data-drop + a public
`/clone-watch` stat. Purely additive on the data F1–F3 produce.

---

## 4. Prerequisites & guardrails (from the research)

- **Enable `FF_SHOPFRONT_CLONE_RECHECK`** — the enabler for F1 + F4. Bounded by the
  urlscan cost brake (`SHOPFRONT_CLONE_OUTREACH_CAP_USD`); **check urlscan quota
  headroom** against ~776 declined/monitoring clones before enabling (batch 50/6h).
- **Do NOT turn the reporter live (`NETCRAFT_ISSUE_DRY_RUN=false`) yet** — gate it
  on confirmed phishing first (F4). We have zero `likely_phishing` clones today, so
  a blind flip only spends standing on declined-parked clones.
- **Honesty invariants** (carry over): never claim a takedown we didn't confirm;
  never self-file UDRP (no standing — package evidence, brand files); four-eyes /
  cooldown / STOP on any brand-facing send.

---

## 5. Build sequence (each shippable, dark-gated)

1. **F1 Weaponisation alert** (`clone-watch-notify-weaponised` + `FF_CLONE_WEAPONISED_ALERT`)
   — highest brand value, small (one new consumer, reuses the notify-brand pattern).
   Enable `FF_SHOPFRONT_CLONE_RECHECK` alongside.
2. **F2 Report + watch-list** — the monthly deliverable brands actually read.
3. **F4 Evidence gate on the reporter** — makes escalation safe; then `DRY_RUN=false`
   is defensible.
4. **F3 Risk intelligence** — deterministic score first; prioritises recheck + the report.
5. **F5** — marketing data-drop when there's a weaponisation event to headline.

## 6. Open questions

1. **Alert autonomy for F1** — four-eyes (admin approves each weaponisation alert)
   or auto-send to verified brands? Recommend four-eyes for the first weeks, then
   auto for `plan ≥ monitor` verified brands.
2. **Report cadence** — monthly (current) vs a weaponisation-triggered mid-cycle
   alert (F1 handles the urgent case; monthly stays the digest).
3. **Risk score v1** — deterministic (ship now) vs wait for enough weaponisation
   samples to train. Recommend deterministic now, revisit.
4. **urlscan budget** — does the free/paid tier headroom cover ~776 clones on a 6h
   recheck? Confirm before enabling recheck.
