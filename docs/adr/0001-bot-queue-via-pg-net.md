# Bot dispatch via Supabase Database Webhook + Vercel Cron sweeper

We dispatch outbound bot messages via a Supabase Database Webhook (`pg_net` on `bot_message_queue` INSERT) with a 10-minute Vercel Cron sweeper as the safety net, instead of polling. `pg_net` is unmetered on Supabase Pro and the webhook is event-driven, so we avoid the per-poll cost and the latency tail of a cron-based dispatcher. The known limitation — `pg_net` does not retry on transport failure — is contained by the sweeper, which atomically reclaims any row pending more than 2 minutes.

## Considered options

- **Cron polling.** Rejected: pays per-poll cost forever even when the queue is empty, and adds dispatch latency equal to the poll interval.
- **Supabase Realtime subscription from a long-running worker.** Rejected: we don't run a long-lived worker tier; everything else is serverless.
- **Inngest fan-out from the `/api/analyze` path.** Rejected for this surface: the queue table is also written from non-analyze paths (admin tools, scheduled brand alerts), and a DB-level trigger captures all writers uniformly.

## Citations

- Table — `supabase/migration-v10-queues.sql` (`bot_message_queue` with status lifecycle `pending → processing → completed | failed`)
- Webhook handler — `apps/web/app/api/bot-webhook/route.ts:61–70` (HMAC verification with `SUPABASE_WEBHOOK_SECRET` via `timingSafeEqual`; atomic claim via `UPDATE ... eq("status", "pending")`)
- Sweeper — `apps/web/app/api/cron/bot-queue-sweep/route.ts:11–24` (Vercel Cron, `CRON_SECRET`, every 10 min, batch ≤ 20, picks up rows pending > 2 min)
