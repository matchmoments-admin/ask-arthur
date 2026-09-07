# Newsletter release acceptance

Status: implementation and local checks; v303 is **not applied to production**. No newsletter, marketing message or trial charge has been sent by this work.

## What changes

Signup requests reserve a confirmation attempt through the v303 RPC. New addresses remain inactive until the holder explicitly confirms. The application sends a random token while the database stores only its SHA-256 hash. Tokens expire after 24 hours; the link keeps the token in its fragment and requires a button POST, so a routine GET link scan does not activate a subscription. This does not promise protection from scanners that execute and interact with pages.

The database request RPC enforces the 15-minute address cooldown, 200-per-UTC-day reservation cap and newsletter_confirmation feature brake. Storage errors do not report success. Hard bounces and complaints update suppression and invalidate pending subscriptions. Weekly send functions inspect provider receipts and throw on partial failure. Their per-recipient, UTC-date idempotency keys reduce duplicate sends within the provider’s 24-hour window; they are not a permanent delivery ledger. Retried accepted receipts may also repeat cost telemetry.

Enforcers: `supabase/migration-v303-newsletter-confirmation.sql`, `apps/web/lib/newsletter-subscription.ts`, `apps/web/app/api/subscribe/confirm/route.ts`, `apps/web/components/ConfirmSubscription.tsx`, `apps/web/app/api/webhooks/resend/route.ts`, `apps/web/lib/resend.ts`.

## Local evidence

- Production Next.js build passed on 2026-09-07 with isolated development configuration, without copying production secrets. This is not a Vercel preview check.
- Existing core checking, inbound email, ownership, Brand Monitor billing and feature-brake regressions passed: 92 tests across ten targeted files at that checkpoint.
- Final email-focused regression run: 33 tests passed across five files on 2026-09-08, covering signup, confirmation, receipts, suppression failures and webhook signatures. Typecheck and SQL lifecycle rerun also passed.
- v303 applied twice to a disposable PGlite PostgreSQL database and lifecycle assertions passed. This is useful runtime SQL evidence but does not exercise Supabase’s full production schema or concurrent sessions.
- Read-only live database and advisor output is in `readiness-baseline.json`. No advisor ERRORs were reported at that baseline. The migration ledger needs reconciliation; do not blindly replay every repository migration after v280.

## Required release sequence

1. Review the diff and reconcile current main and migration numbering. Check live prerequisites and existing object definitions rather than relying only on the migration ledger.
2. Apply v303 to a disposable Supabase preview database with the actual prerequisite schema. Execute the SQL lifecycle assertions in `supabase/tests/newsletter-confirmation.sql`, then run concurrent duplicate-request tests from separate database sessions. Only one request for the same address should reserve a send; the global budget must remain at or below 200.
3. Apply the additive migration through the normal recorded deployment path, regenerate schema-derived types, and compare security/performance advisors with the saved baseline. Do not deploy the dependent application first.
4. Obtain a green Vercel preview and inspect signup and confirmation on desktop and mobile. Confirmation links deliberately target the canonical production origin; preview-only inbox testing needs a separately configured test environment, not a request Host header override.
5. With one expressly nominated controlled inbox, verify sender SPF/DKIM/DMARC and provider webhook setup. Request signup, observe inactive storage, open the email, confirm once, verify active consent, reject replay, unsubscribe and verify inactive state. Request again and verify a fresh confirmation is required. Check a simulated signed complaint suppresses future requests in the test environment.
6. Run a controlled weekly send and observe an accepted provider receipt and actual inbox arrival. Verify the one-click and visible unsubscribe paths, failure retry behaviour and same-payload retry deduplication. Never trigger the production weekly cron just to inspect it: it can send to all active readers and the operator fallback.
7. Record deployed revision, migration record, timestamps and redacted acceptance results. Approve exact content, channel, audience and date before publishing or contacting people.

## Rollback

Pause new confirmations with the existing feature-brake mechanism while investigating. Keep the additive schema in place; it does not rewrite existing subscribers. Do not roll back to code that silently activates arbitrary supplied addresses. Pause the weekly sending control separately if delivery is affected. Preserve suppression records. A broken confirmation path must show a retryable error, not a success message.
