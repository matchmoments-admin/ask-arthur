# Reference — add-inbound-email-source

Detailed templates and reference material for [SKILL.md](SKILL.md). Open this when actually executing the workflow.

## Full architecture

```
1.  Newsletter sender (e.g. ATO scam alerts via GovDelivery)
       │  SMTP delivery to <tag>+ingest@askarthur-inbound.com
       ▼
2.  Cloudflare Email Routing (zone askarthur-inbound.com)
       │  • SPF + DKIM verify (forged senders rejected)
       │  • Subaddressing ON: rule for "ato" matches both ato@ and ato+ingest@
       │  • Action: Send to a Worker → askarthur-intel-inbound-email
       │  • Unmatched addresses → SMTP 550 reject (no catch-all)
       ▼
3.  Cloudflare Worker  (apps/cloudflare-email-worker/src/index.ts)
       │  • postal-mime parses MIME (text + html parts)
       │  • Resolves first link if it's a tracking wrapper (3-hop HEAD, 5s cap)
       │  • Slug derivation: local.split("+")[0]  ↦  inbound_<tag>
       │  • external_id = sha256(Message-ID).slice(0,32)
       │  • POST → Edge Function with X-Webhook-Secret header
       ▼
4.  Supabase Edge Function intel-inbound-email
       │  • POST + JSON Content-Type or 405
       │  • Kill switch ENABLE_INTEL_INBOUND_EMAIL ≠ "true" → 204 (silent drop)
       │  • timingSafeEqual(secret) or 401
       │  • Zod validate 9 fields or 422
       │  • INSERT feed_items; catch 23505 unique_violation = 200 "duplicate"
       ▼
5.  public.feed_items (source = inbound_<tag>, embedding = NULL)
       │
       ├─▶  feed-items-embed Inngest cron (every 30 min)
       │     • get_unembedded_narrative_feed_items() RPC
       │     • Voyage 3 (1024-d) → embedding column
       │
       ├─▶  regulator-alert-push Inngest (every 30 min)
       │     • HIGH-confidence rows → push notifications
       │
       └─▶  (Wave-3, planned) regulator-intel-cluster (weekly Sun)
             • Sonnet 4.6 + Batch API + prompt cache → themes
```

## Decision: when to use email vs RSS scraper

| Symptom in upstream's own site  | Path                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| Has a "Subscribe by email" form | **email path** (this skill)                                  |
| Has an RSS / Atom feed only     | Phase B / D scraper (file an issue with `Epic` #232 or #234) |
| Behind paywall / members-only   | File an issue evaluating value vs cost — don't subscribe     |
| Behind LinkedIn / Twitter only  | Phase E `LinkedIn paid RSS` (#235) — defer until proven need |

The email path is right when there's no other ingestion option. Don't preferentially route RSS-available sources through email — RSS is more deterministic.

## Migration template

Next migration number: run `ls supabase/migration-v*.sql | sort -V | tail -1` to find the latest; add 1. Files are named `migration-v<NNN>-<short-desc>.sql` (no subdirectory).

```sql
-- v<NNN> — Add <source-name> to inbound-email source allowlist.
--
-- Why: <one-line justification — what does this source publish, why is it
-- worth ingesting via email rather than RSS scraper>
--
-- Idempotent: DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING.

-- 1. Extend feed_items_source_check
ALTER TABLE public.feed_items DROP CONSTRAINT IF EXISTS feed_items_source_check;
ALTER TABLE public.feed_items ADD CONSTRAINT feed_items_source_check
  CHECK (source = ANY (ARRAY[
    -- … all existing slugs from the previous migration …
    'inbound_<tag>'   -- new
  ]));

-- 2. Extend RPC allowlist
CREATE OR REPLACE FUNCTION public.get_unembedded_narrative_feed_items(p_limit INT DEFAULT 40)
RETURNS TABLE (id BIGINT, source TEXT, title TEXT, description TEXT, body_md TEXT,
               tags TEXT[], impersonated_brand TEXT, category TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, source, title, description, body_md, tags, impersonated_brand, category
  FROM public.feed_items
  WHERE embedding IS NULL
    AND source IN (
      -- … all existing slugs …
      'inbound_<tag>'
    )
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.get_unembedded_narrative_feed_items(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unembedded_narrative_feed_items(INT) TO service_role;

-- 3. Recreate partial unembedded index with expanded slug list
DROP INDEX IF EXISTS public.idx_feed_items_unembedded_narrative;
CREATE INDEX idx_feed_items_unembedded_narrative
  ON public.feed_items (created_at DESC)
  WHERE embedding IS NULL AND source IN (… all existing + 'inbound_<tag>' …);

-- 4. Seed feed_sources row (enabled=false until subscribe + routing rule)
INSERT INTO public.feed_sources (slug, name, url, source_type, category, jurisdiction, enabled, poll_schedule, notes)
VALUES (
  'inbound_<tag>',
  '<Display name>',
  '<upstream subscribe-form URL>',
  'email', 'narrative', '<AU or INT>', false, 'event-driven',
  '<one-line provenance + tier rationale>'
)
ON CONFLICT (slug) DO NOTHING;
```

Reference: v128 (`migration-v128-inbound-email-sources.sql`) and v129 (`migration-v129-inbound-email-extra-sources.sql`) are the canonical examples.

## Worker change

`apps/cloudflare-email-worker/src/index.ts` — extend `KNOWN_TAGS`:

```typescript
const KNOWN_TAGS = [
  // … existing tags …
  "<tag>", // new
] as const;
```

Then redeploy:

```bash
cd apps/cloudflare-email-worker
pnpm typecheck && pnpm wrangler deploy
```

## Edge Function change

`supabase/functions/intel-inbound-email/index.ts` — TWO places:

```typescript
// 1. Zod source enum (line ~30):
const InboundEmailPayload = z.object({
  source: z.enum([
    // … existing slugs …
    "inbound_<tag>", // new
  ]),
  // …
});

// 2. provenanceTierFor() mapping (line ~85):
function provenanceTierFor(source: string): string {
  switch (source) {
    // … existing cases …
    case "inbound_<tag>":
      return "tier_1_regulator"; // or tier_2_industry / tier_3_curated
    default:
      return "tier_4_osint";
  }
}
```

Then redeploy:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… \
  supabase functions deploy intel-inbound-email \
  --project-ref rquomhcgnodxzkhokwni \
  --no-verify-jwt
```

The `--no-verify-jwt` flag is non-negotiable — this is a public webhook receiver authed by `X-Webhook-Secret`, not by a Supabase JWT.

## Cloudflare routing rule

API path (preferred, idempotent, scriptable):

```bash
CF_TOKEN="…"                          # ask user to generate; see SKILL.md tokens
ZONE_ID="899264c25d8706e08eeb03653c990488"
WORKER_NAME="askarthur-intel-inbound-email"
DOMAIN="askarthur-inbound.com"
TAG="<tag>"                            # e.g. "ato"

curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Route $TAG to Worker\",
    \"enabled\": true,
    \"matchers\": [{\"type\": \"literal\", \"field\": \"to\", \"value\": \"$TAG@$DOMAIN\"}],
    \"actions\": [{\"type\": \"worker\", \"value\": [\"$WORKER_NAME\"]}]
  }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅' if d.get('success') else '❌', d.get('result', {}).get('id') or d.get('errors'))"
```

Dashboard alternative: `askarthur-inbound.com` → Email → Email Routing → **Routing rules** → **Create address** → custom address `<tag>`, action **Send to a Worker** → `askarthur-intel-inbound-email`. Subaddressing is already on, so the rule for `<tag>` matches both `<tag>@` and `<tag>+ingest@`.

## Subscribe → confirm → verify

1. Subscribe at the upstream's form using `<tag>+ingest@askarthur-inbound.com`.
2. The confirmation email arrives at the Worker → Edge Function → `feed_items` like any other email.
3. Find the confirm link:

```sql
-- Verification SQL — paste at https://supabase.com/dashboard/project/rquomhcgnodxzkhokwni/sql/new
SELECT id, source, title, substring(body_md, 1, 200) AS body, url, created_at
FROM public.feed_items
WHERE source = 'inbound_<tag>'
ORDER BY created_at DESC
LIMIT 5;
```

4. Copy the confirm URL (often the first link in `body_md`; sometimes the resolved `url` column). Paste in browser to confirm. **Watch out for the trailing-paren bug (issue #237)** — strip a trailing `)` if the URL ends with one.
5. Wait ≤30 min, then check that the row got embedded:

```sql
SELECT id, source, embedding IS NOT NULL AS embedded FROM public.feed_items
WHERE source = 'inbound_<tag>' ORDER BY created_at DESC LIMIT 5;
```

If `embedded = true` for at least one row, the full path works. From here, real upstream content will trickle in automatically.

## Troubleshooting

| Symptom                                                                             | Cause                                                                                         | Fix                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Edge Function 401 from Worker                                                       | Secret mismatch                                                                               | Rotate per `docs/ops/inbound-email-config.md` "Secret rotation"         |
| Edge Function 422 with `validation_failed` issues mentioning unknown source enum    | Forgot to update Zod enum in Edge Function                                                    | Step 5 in workflow — both places                                        |
| INSERT fails with `feed_items_source_check` violation                               | Migration didn't apply or constraint wasn't extended                                          | Re-run migration via `mcp__supabase__apply_migration`                   |
| `there is no unique or exclusion constraint matching the ON CONFLICT specification` | Partial unique index can't be used with PostgREST `upsert(onConflict)`                        | Edge Function already uses INSERT + 23505 catch — confirm latest deploy |
| Confirmation email arrives at `inbound_generic` instead of `inbound_<tag>`          | Worker `KNOWN_TAGS` not updated, or Worker wasn't redeployed                                  | Step 4 + redeploy                                                       |
| Routing rule POST returns `Authentication error` (code 10000)                       | API token missing `Zone:Email Routing Rules:Edit` (zone-scoped)                               | Edit token to add zone-scoped permission                                |
| Subscription form rejects `<tag>+ingest@…`                                          | Some forms strip `+`-tags; try `<tag>@askarthur-inbound.com` directly (also works, same rule) | Subaddressing-aware fallback                                            |
| Embedding never populates                                                           | Source slug missing from `get_unembedded_narrative_feed_items()` allowlist                    | Step 3 — RPC allowlist is a separate place from the constraint          |

## Adjacent skills + issues

- **PR-A4** (deferred, issue #236) — per-tag sender-domain allowlist + volume telemetry. Useful follow-up once a new source has real traffic.
- **Issue #237** — `extractFirstUrl` trailing-paren bug; affects how the confirm link is stored.
- **Issue #232** — Phase B scrapers, for sources that should NOT use the email path.
