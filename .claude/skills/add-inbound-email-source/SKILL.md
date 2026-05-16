---
name: add-inbound-email-source
description: Add a new email-subscription source to the AskArthur inbound-email pipeline (Cloudflare Email Routing → Worker → Supabase Edge Function → feed_items). Use when the user wants to subscribe to a new threat-intel newsletter, gov-alert email, or RSS-replacement subscription on askarthur-inbound.com — typically Scamwatch-style GovDelivery emails, Substack security newsletters, or vendor alert services. Triggers: "add this newsletter", "subscribe to <source>", "extend the source list", "new inbound-email tag".
---

# Add inbound-email source

Walk-through for adding a new tagged email subscription end-to-end. The pipeline already exists (shipped 2026-05-15 as PR-A3, migrations v127–v129); this skill is the playbook for extending it.

## Architecture in one paragraph

Upstream newsletters send mail to `<tag>+ingest@askarthur-inbound.com` → Cloudflare Email Routing matches the per-address rule → invokes the **Cloudflare Worker** `askarthur-intel-inbound-email` (Email-Workers binding) → Worker parses MIME with `postal-mime`, derives `source = inbound_<tag>` from the local-part, hashes Message-ID into an idempotency key → POSTs JSON to the **Supabase Edge Function** `intel-inbound-email` (auth via `X-Webhook-Secret`) → Edge Function validates with Zod and inserts a row into `public.feed_items`. The existing `feed-items-embed` Inngest job (every 30 min) picks up the row and runs Voyage 3 embedding. See [REFERENCE.md](REFERENCE.md) for the full diagram.

## 8-step workflow

1. **Pick a tag** — short `snake_case`, e.g. `ato`, `ic3`, `cisa_alerts`. Avoid `+`, `.`, or chars that conflict with email-address local-parts.
2. **Pick a tier** — `tier_1_regulator` (gov), `tier_2_industry` (CERT/expert), `tier_3_curated` (editorial), `tier_4_osint` (generic). Drives downstream weighting.
3. **Write migration v<NNN>** — extends `feed_items_source_check` constraint + `get_unembedded_narrative_feed_items()` RPC + the partial unembedded index + seeds a `feed_sources` row (`enabled=false`). Template in [REFERENCE.md](REFERENCE.md#migration-template).
4. **Update Worker** — add tag to `KNOWN_TAGS` in `apps/cloudflare-email-worker/src/index.ts`.
5. **Update Edge Function** — add slug to Zod source enum **and** to `provenanceTierFor()` mapping in `supabase/functions/intel-inbound-email/index.ts`.
6. **Apply + redeploy** — `mcp__supabase__apply_migration` (project `rquomhcgnodxzkhokwni`), then `supabase functions deploy intel-inbound-email --no-verify-jwt`, then `pnpm wrangler deploy` from `apps/cloudflare-email-worker/`.
7. **Add Cloudflare Email Routing rule** — one POST to the Cloudflare API per tag, or click "Create address" in the dashboard. Curl wrapper in [REFERENCE.md](REFERENCE.md#cloudflare-routing-rule).
8. **Subscribe + verify** — sign up at upstream using `<tag>+ingest@askarthur-inbound.com`, then run the verification SQL in [REFERENCE.md](REFERENCE.md#verification-sql).

## Critical IDs — do not change

| What                  | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Supabase project ref  | `rquomhcgnodxzkhokwni`                                                   |
| Cloudflare zone ID    | `899264c25d8706e08eeb03653c990488` (`askarthur-inbound.com`)             |
| Cloudflare account ID | `192777a993ba94d262ede60d8f9a480c`                                       |
| Worker name           | `askarthur-intel-inbound-email`                                          |
| Edge Function URL     | `https://rquomhcgnodxzkhokwni.functions.supabase.co/intel-inbound-email` |
| Local secret backup   | `~/.askarthur-inbound-email-secret.txt` (mode 600)                       |

## Tokens required at runtime

The user must provide these — neither persists between sessions, both should be revoked after use.

- **Supabase Personal Access Token**: https://supabase.com/dashboard/account/tokens → "Generate new token". Used inline as `SUPABASE_ACCESS_TOKEN=sbp_...` for every `supabase` CLI call.
- **Cloudflare API token**: https://dash.cloudflare.com/profile/api-tokens → "Create Custom Token" with permissions:
  - `Zone` → `Email Routing Rules` → `Edit` (zone-scoped, `askarthur-inbound.com`)
  - `Zone` → `Email Routing Addresses` → `Edit` (account-scoped)
  - `User` → `User Details` → `Read` (account-scoped, for verify endpoint)

Ask the user for both, use inline, and remind them to revoke once routing rule(s) created.

## When NOT to use this skill

- Source has an **RSS feed** → write a Python scraper in `pipeline/scrapers/` instead (Phase B PR pattern in `docs/plans/threat-intel-ingestion.md` §7). RSS path is more reliable than email forwarding for sources that publish on a schedule. **Two rules locked in via PR-B3 (#247) — `curl -I` the upstream feed URL pre-merge** (AUSTRAC originally guessed a Drupal-convention path that 404'd; real feed is `/media-release/rss.xml`), and **for any scraper with `_infer_category()` logic, check specific patterns before generic** (an "investment scam" article matches generic `scam | fraud` first otherwise and mislabels as impersonation).
- Source is **paid/members-only** with no public email → file an issue describing the value vs cost, don't try to subscribe.
- Just adding a **routing rule** for an existing tag → only step 7, all other state already exists.

## Cost

A$0 per email. No Claude call in the per-email path. Voyage embedding is ~A$0.00006 per row, captured by the existing 30-min `feed-items-embed` job. The Wave-3 weekly regulator clustering is the only Claude spend downstream, and it's gated by `FF_REGULATOR_INTEL_THEMES` + brake `regulator_intel` at A$5/day.

## Related files

- [REFERENCE.md](REFERENCE.md) — architecture diagram, code templates, troubleshooting
- `docs/ops/inbound-email-config.md` — operator-facing setup + monitoring queries
- `docs/plans/threat-intel-ingestion.md` — the plan this skill operationalises
- `supabase/migration-v127-feed-sources.sql` — the feed_sources registry
- `supabase/migration-v128-inbound-email-sources.sql` — original 12 inbound\_\* slugs. NB: this migration shipped without the matching `feed_sources` INSERTs — v130 backfilled them. Step 3 above (`feed_sources` row paired with the slug, same migration) prevents the repeat.
- `supabase/migration-v129-inbound-email-extra-sources.sql` — 5 high-signal additions (ATO, SANS, TLDR, THN, SecurityWeek). Reference shape: source_check + RPC + index + feed_sources INSERT all in one file.
- `supabase/migration-v130-feed-sources-inbound-backfill.sql` — the v128 backfill itself.
