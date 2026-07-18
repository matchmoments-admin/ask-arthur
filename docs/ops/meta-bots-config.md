# Meta messaging bots — activation runbook (WhatsApp + Messenger)

Founder-executable steps to take the two Meta messaging bots from
**code-complete** to **live**. The code already ships:

- **WhatsApp bot** — `apps/web/lib/bots/whatsapp/handler.ts`, webhook
  `apps/web/app/api/webhooks/whatsapp/route.ts`.
- **Messenger bot** — `apps/web/lib/bots/messenger/handler.ts`, webhook
  `apps/web/app/api/webhooks/messenger/route.ts`.

Both: forward a suspicious message or screenshot → Claude verdict → a
**real, logged "Report scam"** flow through the onward-reporting brain
(shipped in the bots-onward PR — `apps/web/lib/bots/onward-report.ts`). No code
change is needed to go live — only Meta-side config + the env vars below.

> **Feasibility basis:** both are user-initiated utility bots that reply inside
> Meta's 24-hour service/standard messaging window — no template pre-approval
> needed for the reply. See [ADR-0023](../adr/0023-meta-platform-boundaries.md)
> for what Meta does and does NOT allow (Marketplace ingestion is blocked;
> report-to-Meta is brand-gated BRP only).

---

## 0. Prerequisites (once per Meta app)

App = **"Just Ask Arthur"** (status: Unpublished as of 2026-07-19).

1. **Meta app** created (done).
2. **Trim use cases to what we ship.** The dashboard currently lists Threads,
   "Manage everything on your Page", WhatsApp, Instagram, "Engage with customers
   on Messenger", and Ads Agentic. App Review scope = the sum of your use
   cases, so **remove everything except**:
   - **Connect with customers through WhatsApp** (the WhatsApp bot)
   - **Engage with customers on Messenger from Meta** (the Messenger bot)
   - Keep the **Page** connection only insofar as Messenger needs a linked Page.
   - Instagram: keep ONLY if you're building the IG DM bot now (not built yet —
     see the handoff doc); otherwise remove it to shrink review.
   - Threads / Ads Agentic / Facebook Login for Business are **not used by the
     bots** — remove to avoid extra review burden.
3. **Meta Business verification** completed for the Business that owns the app
   (Business Settings → Security Center).
4. **Become a Tech Provider + access verification.** The dashboard's "Become a
   Tech Provider" step is **required to submit to App Review** and request the
   messaging permissions for public (non-tester) use. Complete this before §1.4
   / §2.4 app review.
5. Production domain reachable: `https://askarthur.au` (webhooks must be HTTPS
   with a valid cert — Vercel prod already is).

---

## 1. WhatsApp (Cloud API)

**Permissions to request:** `whatsapp_business_messaging`,
`whatsapp_business_management`.

1. Add the **WhatsApp** product to the app; connect a WhatsApp Business Account
   and phone number (or use the test number for smoke-testing first).
2. Set Vercel env (Production) — values from the app's WhatsApp → API Setup:
   - `WHATSAPP_ACCESS_TOKEN` — a permanent System User token (not the 24h temp
     token), scoped to the WABA.
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_APP_SECRET` — App Settings → Basic → App Secret.
   - `WHATSAPP_VERIFY_TOKEN` — any random string you choose (you'll paste the
     same value into the webhook config below).
3. **Configure the webhook:** WhatsApp → Configuration →
   - Callback URL: `https://askarthur.au/api/webhooks/whatsapp`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` value.
   - Click **Verify and save** (Meta GETs the URL; the route echoes
     `hub.challenge` when the token matches).
   - **Subscribe** to the `messages` field.
4. **App review:** submit `whatsapp_business_messaging` for **Advanced Access**
   (needed to message users who aren't app admins/testers).

---

## 2. Facebook Messenger (Meta Platform)

**Permissions to request:** `pages_messaging` (depends on `business_management`).

1. Add the **Messenger** product; connect the **Ask Arthur Facebook Page**
   (Messenger → Settings → link your Page, generate a Page access token).
2. Set Vercel env (Production):
   - `MESSENGER_PAGE_ACCESS_TOKEN` — the Page token from step 1.
   - `MESSENGER_APP_SECRET` — the same App Secret as WhatsApp (same app).
   - `MESSENGER_VERIFY_TOKEN` — any random string you choose.
3. **Configure the webhook:** Messenger → Settings → Webhooks →
   - Callback URL: `https://askarthur.au/api/webhooks/messenger`
   - Verify token: the `MESSENGER_VERIFY_TOKEN` value → **Verify and save**.
   - **Subscribe** the Page to: `messages`, `messaging_postbacks`
     (postbacks carry the "Report scam" / "Check another" / "About" taps).
4. **App review:** submit `pages_messaging` for Advanced Access (public use).
   Meta's review is typically a few business days; include a screencast of the
   forward-a-scam → verdict → report flow.

---

## 3. Smoke test (after each webhook verifies)

Run BEFORE and AFTER app review — pre-review works for app admins/testers.

1. **Webhook handshake** — the "Verify and save" step already proves the GET
   handshake; a 200 with the echoed challenge = the `*_VERIFY_TOKEN` matches.
2. From a test user, send the bot:
   - a plain suspicious message (e.g. a bank-impersonation text) → expect a
     verdict reply with **Report scam / Check another / About** buttons.
   - a **screenshot** of a scam → expect an image-analysis verdict.
3. Tap **Report scam** → expect a destination-aware reply (Scamwatch link +
   paste-ready evidence). Confirm a row landed:
   `select * from onward_report_log order by created_at desc limit 3;`
4. Confirm cost telemetry: `select * from cost_telemetry where feature='bot_analyze' order by created_at desc limit 3;` (Messenger shares the WhatsApp path, so cost + rate-limit + PII-scrub parity is automatic).

---

## 4. Publish

The app is **Unpublished**. Once both use cases pass App Review and the smoke
test is green, use the dashboard **Publish** step (Dashboard → "Check that all
requirements are met, then publish your app") to switch the app to Live. Until
then only app admins/testers/roles can message the bots.

---

## Telemetry / safety parity (already wired — no action)

Both bots go through the shared `analyzeForBotDetailed` path, so they inherit:
`checkBotRateLimit` (per-platform Redis throttle), `logCost({feature:
"bot_analyze"})`, the `bot_analyze` cost brake, PII scrubbing in
`storeScamReport`, first-time AI-disclosure, and replay dedup. The `BOT_ANALYZE_CAP_USD`
brake caps combined Telegram/WhatsApp/Messenger/Slack Claude spend.

## Rollback

Unsubscribe the webhook fields in the Meta dashboard, or blank the
`*_ACCESS_TOKEN` env vars — the webhook routes then no-op (no token → the send
API logs "not configured" and returns without messaging). No migration to
reverse.
