# Ask Arthur — Bots, Mobile App & Breach Check Setup Guide

This document covers how to set up and test each new component: Telegram bot, WhatsApp bot, Slack bot, the Expo mobile app, and the HIBP breach check API.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Telegram Bot](#telegram-bot)
3. [WhatsApp Bot](#whatsapp-bot)
4. [Slack Bot](#slack-bot)
5. [Breach Check API (HIBP)](#breach-check-api-hibp)
6. [Expo Mobile App](#expo-mobile-app)
7. [Vercel Deployment](#vercel-deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Make sure the monorepo builds cleanly:

```bash
pnpm install
pnpm turbo build
pnpm --filter @askarthur/bot-core test   # 27 tests should pass
```

All bot env vars go in `apps/web/.env.local`. Copy from `.env.example` if you haven't already.

---

## Telegram Bot

### 1. Create the bot with BotFather

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g. "Ask Arthur") and a username (e.g. `AskArthurBot`)
4. Copy the **bot token** BotFather gives you

### 2. Configure env vars

Add to `apps/web/.env.local`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxyz
TELEGRAM_WEBHOOK_SECRET=any-random-secret-string-you-choose
```

The `TELEGRAM_WEBHOOK_SECRET` can be any random string — it's used to verify incoming webhook requests. Generate one with:

```bash
openssl rand -hex 32
```

### 3. Test locally (long-polling mode)

Long-polling mode connects directly to Telegram's servers — no public URL needed:

```bash
pnpm dev:telegram
```

You should see: `Telegram bot @YourBotUsername running (long-polling mode)`

Now message your bot on Telegram:
- Send `/start` — should get welcome message
- Send `/help` — should get command list
- Send any text — should get scam analysis result
- Send `/check <paste suspicious text>` — explicit check

### 4. Set up webhook for production

Once deployed to Vercel, register the webhook URL with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://askarthur.au/api/webhooks/telegram",
    "secret_token": "<YOUR_TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Verify it's set:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

You should see `"url": "https://askarthur.au/api/webhooks/telegram"` with no errors.

### 5. Set bot commands (optional but recommended)

Tell Telegram about your commands so users see them in the menu:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{
    "commands": [
      {"command": "start", "description": "Welcome message and usage guide"},
      {"command": "check", "description": "Check a message for scams"},
      {"command": "help", "description": "Show available commands"},
      {"command": "privacy", "description": "Privacy information"}
    ]
  }'
```

---

## WhatsApp Bot

### 1. Create a Meta developer app

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new app → select "Business" type
3. Add the **WhatsApp** product to your app
4. In WhatsApp > Getting Started, you'll see a **temporary access token** and **Phone Number ID**

### 2. Configure env vars

```env
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxx...
WHATSAPP_VERIFY_TOKEN=any-random-string-you-choose
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_APP_SECRET=your-app-secret-from-meta-dashboard
```

- `WHATSAPP_ACCESS_TOKEN`: From Meta developer dashboard (WhatsApp > API Setup). For production, generate a permanent System User token.
- `WHATSAPP_VERIFY_TOKEN`: Any string you choose — Meta sends this during webhook verification.
- `WHATSAPP_PHONE_NUMBER_ID`: From the API Setup page.
- `WHATSAPP_APP_SECRET`: Found in App Settings > Basic > App Secret.

### 3. Test locally with ngrok

WhatsApp requires a public HTTPS URL for webhooks:

```bash
# Terminal 1: Start the web app
pnpm dev:web

# Terminal 2: Start ngrok tunnel
ngrok http 3000
```

Copy the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app`).

### 4. Register the webhook

1. In Meta developer dashboard, go to **WhatsApp > Configuration**
2. Click **Edit** on the Webhook section
3. Set **Callback URL** to: `https://abc123.ngrok-free.app/api/webhooks/whatsapp`
4. Set **Verify token** to the same value as your `WHATSAPP_VERIFY_TOKEN`
5. Click **Verify and Save**
6. Subscribe to the `messages` webhook field

### 5. Test

Send a message to your WhatsApp test number from the phone number you've added to the allowlist in the Meta dashboard.

### 6. Production

For production:
1. Complete Meta's business verification process
2. Generate a permanent System User access token
3. Set webhook URL to `https://askarthur.au/api/webhooks/whatsapp`
4. Add your production phone number

---

## Slack Bot

### 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it "Ask Arthur" and select your workspace

### 2. Configure the slash command

1. In your app settings, go to **Slash Commands**
2. Click **Create New Command**:
   - **Command**: `/checkscam`
   - **Request URL**: `https://askarthur.au/api/webhooks/slack` (or ngrok URL for testing)
   - **Short Description**: "Check a message for scams"
   - **Usage Hint**: "[paste suspicious message]"

### 3. Get credentials

1. Go to **Basic Information** in your app settings
2. Copy the **Signing Secret**

Add to `apps/web/.env.local`:

```env
SLACK_SIGNING_SECRET=your-signing-secret-here
```

(`SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are not needed for the slash command MVP — only the signing secret is required.)

### 4. Install to workspace

1. Go to **Install App** in your app settings
2. Click **Install to Workspace**
3. Authorize the app

### 5. Test locally with ngrok

```bash
# Terminal 1
pnpm dev:web

# Terminal 2
ngrok http 3000
```

Update the slash command Request URL to your ngrok URL, then in Slack type:

```
/checkscam You've won a $1000 gift card! Click here to claim: http://suspicious-link.com
```

You should see "Analysing message for scam indicators..." followed by the full Block Kit result.

### 6. Production

Update the slash command Request URL to `https://askarthur.au/api/webhooks/slack`.

---

## Breach Check API (HIBP)

### 1. Get an API key

1. Go to [haveibeenpwned.com/API/Key](https://haveibeenpwned.com/API/Key)
2. Purchase the **Pwned 1** plan ($4.50 USD/month)
3. Copy your API key

### 2. Configure env var

```env
HIBP_API_KEY=your-hibp-api-key
```

### 3. Test locally

```bash
pnpm dev:web
```

Then:

```bash
curl -X POST http://localhost:3000/api/breach-check \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

**Response if breached:**
```json
{
  "breached": true,
  "breachCount": 3,
  "breaches": [
    {
      "name": "LinkedIn",
      "title": "LinkedIn",
      "domain": "linkedin.com",
      "date": "2012-05-05",
      "dataTypes": ["Email addresses", "Passwords"]
    }
  ]
}
```

**Response if clean:**
```json
{
  "breached": false,
  "breachCount": 0,
  "breaches": []
}
```

### 4. Rate limits

- 5 requests per hour per IP address (uses the existing `checkFormRateLimit`)
- HIBP's own limit is 10 requests per minute on the Pwned 1 plan

---

## Expo Mobile App

### 1. Install Expo CLI

```bash
npm install -g expo-cli eas-cli
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure API URL

For local development, the mobile app needs to reach your dev server. Set in `apps/mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

Replace `192.168.x.x` with your machine's local IP (find it with `ifconfig | grep "inet "` on macOS).

For production, this defaults to `https://askarthur.au`.

### 4. Run in development

```bash
# Terminal 1: Start the web API
pnpm dev:web

# Terminal 2: Start Expo
pnpm dev:mobile
```

This opens the Expo dev tools. Scan the QR code with:
- **iOS**: Camera app → opens in Expo Go
- **Android**: Expo Go app → scan QR code

### 5. Test each tab

| Tab | What to test | Expected |
|-----|-------------|----------|
| **Scan** | Point camera at a QR code containing a URL | Scam analysis result with verdict |
| **Check** | Paste "You've won $10,000! Reply with your bank details" | HIGH_RISK verdict |
| **Breach** | Enter an email address | Breach results from HIBP |
| **Settings** | Tap Privacy Policy link | Opens askarthur.au/privacy in browser |

### 6. Build for app stores (when ready)

```bash
# Login to EAS
eas login

# Configure (first time only)
cd apps/mobile
eas build:configure

# Build
eas build --platform ios
eas build --platform android
```

The EAS free tier gives 15 iOS + 15 Android builds per month.

---

## Vercel Deployment

The bot webhook routes deploy automatically with the web app. No extra infrastructure needed.

### 1. Add env vars in Vercel

Go to your Vercel project settings > Environment Variables and add:

| Variable | Required for |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram bot |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp bot |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp bot |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp bot |
| `WHATSAPP_APP_SECRET` | WhatsApp bot |
| `SLACK_SIGNING_SECRET` | Slack bot |
| `HIBP_API_KEY` | Breach check |

You only need to add the vars for the bots you want to activate. Routes without their env vars configured will return 503/401 gracefully.

### 2. Deploy

Push to your branch and Vercel deploys automatically. Or:

```bash
git push origin feat/monorepo-conversion
```

### 3. Post-deploy: register webhooks

After deployment, register the webhook URLs:

- **Telegram**: `curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" ...` (see Telegram section above)
- **WhatsApp**: Update webhook URL in Meta developer dashboard
- **Slack**: Update slash command Request URL in Slack app settings

---

## Troubleshooting

### Bot returns no response

- Check that the relevant env vars are set (e.g. `TELEGRAM_BOT_TOKEN`)
- Check Vercel function logs for errors
- Verify webhook is registered correctly (Telegram: `getWebhookInfo`, WhatsApp: Meta dashboard, Slack: app settings)

### "Rate limit exceeded" on bots

- Default limit: 5 checks per hour per user per platform
- Requires Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
- In dev without Redis, rate limiting is disabled (fail-open)

### Telegram webhook 401

- Verify `TELEGRAM_WEBHOOK_SECRET` matches what you passed to `setWebhook`
- The header `X-Telegram-Bot-Api-Secret-Token` must match exactly

### WhatsApp webhook 401

- Check `WHATSAPP_APP_SECRET` is correct (from Meta App Settings > Basic)
- Verify the signature is being sent (check Meta webhook logs)

### Slack "dispatch_failed"

- The route must respond within 3 seconds — if analysis takes longer, the initial "Analysing..." ack handles this
- Verify `SLACK_SIGNING_SECRET` matches your app's signing secret

### Mobile app can't reach API

- Ensure `EXPO_PUBLIC_API_URL` points to your dev machine's IP (not `localhost`)
- Check that the web app is running on port 3000
- On iOS simulator, use `http://localhost:3000`

### Breach check returns 503

- `HIBP_API_KEY` is not set
- Check that your HIBP subscription is active at haveibeenpwned.com/API/Key

### Build errors

```bash
# Clean and rebuild
pnpm turbo clean
pnpm install
pnpm turbo build
```
