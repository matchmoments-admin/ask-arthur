# Phase 1 runbook — competitor scam-newsletter ingest

> **STATUS: infra SHIPPED 2026-07-08.** Migrations v209 + v210 applied to prod;
> Edge Function `intel-inbound-email` redeployed (v10); Worker
> `askarthur-intel-inbound-email` redeployed; 5 CF email-routing rules created;
> full contract verified via synthetic row (constraint accepts, category stamps,
> promote-guard refuses, embed-eligible). **Remaining = the human subscribe step
> (§"Step 4") — nothing else blocks ingest.**
>
> Operationalises Phase 1 of [`arthurs-watch-newsletter.md`](./arthurs-watch-newsletter.md).
> Uses the `add-inbound-email-source` skill. **Cost: A$0/email** (embedding only,
> ~A$0.00006/row). Nothing here is consumer-facing — rows land quarantined
> (`published=false`, `category='competitor_intel'`) and feed intelligence only.
>
> **No dedicated feature flag.** Competitor ingest is gated by (a) a CF routing
> rule existing for the tag, (b) the newsletter actually being subscribed, and
> (c) the existing `ENABLE_INTEL_INBOUND_EMAIL` kill switch. To stop a single
> source, delete its CF routing rule or set its `feed_sources.enabled=false` —
> no code change. A per-source flag was judged unnecessary given the content is
> inert (quarantined, never published).
>
> **Why this is worth doing regardless of the newsletter:** the ingested signal
> is independently useful for (a) the public feed and (b) surfacing new scams —
> _as intelligence_. We write our own feed entries / reports **in our own words**
> from what these newsletters reveal; we never republish their content (ADR-0021).

## Order of operations (important)

The Edge Function drops `tier_3_curated` sources at ingest today. Consumer scam
newsletters are curated editorial → **they'd be silently dropped, including the
confirmation emails.** So the gate exception must ship _before_ you subscribe:

1. **[me]** Write code — migration v209, Worker, Edge Function + gate exception.
2. **[you]** Generate two throwaway tokens (Supabase + Cloudflare).
3. **[me]** Apply migration, redeploy Edge Function + Worker, create CF routing rules.
4. **[you]** Subscribe at each newsletter using the tagged address; click confirm.
5. **[me]** Verify rows land + embed; confirm the promote guard refuses them.
6. **[you]** Revoke the two tokens.

## Step 1 — code (me, no tokens needed)

- **Migration v209** — add the 5 slugs to `feed_items_source_check`, the
  `get_unembedded_narrative_feed_items()` RPC allowlist, and the partial
  unembedded index; seed 5 `feed_sources` rows (`enabled=false`); add the
  `competitor_intel` category marker.
- **Worker** `apps/cloudflare-email-worker/src/index.ts` — add the 5 tags to
  `KNOWN_TAGS`.
- **Edge Function** `supabase/functions/intel-inbound-email/index.ts` — add the 5
  slugs to the Zod enum + `provenanceTierFor()`, and add the
  `COMPETITOR_INTEL_SOURCES` allowlist that bypasses the tier_3 drop and stamps
  `category='competitor_intel'`.
- **Promote guard** `apps/web/app/admin/inbound-quarantine/actions.ts` — refuse
  promotion of `category='competitor_intel'` rows.

## Step 2 & 6 — your tokens (throwaway, revoke after step 5)

- **Supabase PAT** — https://supabase.com/dashboard/account/tokens → "Generate new
  token". Paste it to me; I use it inline for the deploy, never stored.
- **Cloudflare API token** — https://dash.cloudflare.com/profile/api-tokens →
  "Create Custom Token", permissions:
  - `Zone` → `Email Routing Rules` → `Edit` (zone `askarthur-inbound.com`)
  - `Zone` → `Email Routing Addresses` → `Edit`
  - `User` → `User Details` → `Read`

  _(Or skip the CF token and create the 5 routing rules yourself in the dashboard:
  askarthur-inbound.com → Email → Email Routing → Routing rules → Create address
  → custom address `<tag>` → action "Send to a Worker" → `askarthur-intel-inbound-email`.)_

## Step 4 — subscribe (you)

Sign up at each with the **tagged address** so it routes to the right source slug.
Subaddressing is on, so if a form rejects the `+ingest` part, drop it and use
`<tag>@askarthur-inbound.com` — same rule matches.

| Newsletter                    | Subscribe with this address                | Sign-up link                                        | Notes                                                                                                         |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Which? Scam Alerts** (UK)   | `which_scams+ingest@askarthur-inbound.com` | https://signup.which.co.uk/wlp-scamalert-newsletter | The benchmark. Free, weekly, open signup.                                                                     |
| **AARP Watchdog Alerts** (US) | `aarp_fraud+ingest@askarthur-inbound.com`  | https://www.aarp.org/watchdogalerts                 | Free, twice-monthly. May want a US ZIP — use any valid US ZIP (e.g. 20049, AARP HQ).                          |
| **MoneySavingExpert** (UK)    | `mse+ingest@askarthur-inbound.com`         | https://www.moneysavingexpert.com/site/signup/      | Weekly (Wed). Scam section inside the money email. Open signup.                                               |
| ~~This Week in Scams~~        | —                                          | —                                                   | **Removed 2026-07-08 (v211)** — Substack dormant / no longer relevant. Trialed in v209, removed forward-only. |

**Bonus already-ingested / optional:**

- **Scamwatch (AU)** — already ingested as `inbound_scamwatch` (tier_1 regulator,
  publishable). If not currently subscribed:
  https://www.scamwatch.gov.au/about-us/news-and-alerts/subscribe-to-scam-alert-emails
- No independent **AU-origin consumer** scam newsletter with an email signup
  surfaced — that's the market gap the research identified. AU signal comes from
  Scamwatch + our own Reddit/user-report streams for now.

After you subscribe, each sends a **double-opt-in confirmation email** that flows
through the pipeline. I'll fetch the confirm link from the DB and give it to you
to click (watch the trailing-`)` bug, issue #237). Then real content trickles in
automatically.

## Step 5 — verify (me)

```sql
SELECT source, category, published, embedding IS NOT NULL AS embedded,
       substring(title,1,60) AS title, created_at
FROM public.feed_items
WHERE source IN ('inbound_which_scams','inbound_aarp_fraud','inbound_mse','inbound_frankonfraud')
ORDER BY created_at DESC LIMIT 20;
```

Expect `category='competitor_intel'`, `published=false`, `embedded=true` within
one embed cycle (~4h). Then re-run `mcp__supabase__get_advisors` after v209.

## Open decision surfaced by "good info for the feed too"

You noted this is valuable for the feed + reporting regardless of the newsletter.
Two ways to honour that without republishing competitor content:

- **v1 (recommended):** keep the raw newsletters quarantined (`competitor_intel`),
  and let the scams they describe inform **our own** feed entries / scam reports,
  written in our words by a later synthesis step. Clean on copyright + trust.
- **Alternative:** relax the never-publish rule for a specific low-risk source.
  Not recommended — republishing a competitor's alert (often with their
  screenshots) is the copyright/trust exposure ADR-0021 exists to avoid.

Decision can wait — Phase 1 ingest is identical either way.
