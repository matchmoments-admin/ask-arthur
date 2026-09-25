# @askarthur/cloudflare-email-worker

Cloudflare Email Routing Worker for the inbound addresses (newsletter intel +
`scan@` user reports). Parses MIME with postal-mime and POSTs a structured
payload to the intel Edge Function or `/api/inbound-scan`.

## Quarantine

Messages the Worker cannot deliver — MIME parse failure, missing scan endpoint,
fetch error, or a 5xx from the target — are forwarded with
`message.forward(QUARANTINE_ADDRESS)` and a `X-AskArthur-Quarantine-Reason`
header, for manual replay. 4xx responses are logged but not quarantined (a
contract bug; replaying would fail the same way).

`QUARANTINE_ADDRESS` (set under `[vars]` in `wrangler.toml`) **must be a
verified destination address** in Cloudflare Email Routing (dashboard → Email →
Email Routing → Destination addresses). `forward()` rejects any other address;
the Worker logs that failure. If the variable is unset the Worker logs
`QUARANTINE_ADDRESS unset — message dropped` at error level.

## Sender-authentication visibility

Each `inbound-email: received` log line carries `auth_results` — the
`spf=` / `dkim=` / `dmarc=` verdict tokens parsed from the
`Authentication-Results` header (presence + verdicts only, no addresses). This
is groundwork for replying to `scan@` senders only when DMARC passes.

## Deploy (manual)

```bash
cd apps/cloudflare-email-worker
pnpm test && pnpm typecheck
npx wrangler whoami            # confirm the account that owns the zone
npx wrangler deploy
npx wrangler tail              # watch a test message arrive
```
