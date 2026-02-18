# Phase 2 Setup Guide — Deepfake Detection + Phone Intelligence

Everything you need to configure before turning on the feature flags. Complete each section in order.

---

## Prerequisites

Phase 1 must be built and deployed first. Phase 2 code is already in the repo behind feature flags (all OFF by default), but it depends on Phase 1 infrastructure that doesn't exist yet:

| Phase 1 Dependency | Status | What It Provides |
|---|---|---|
| `media_analyses` table | Not built | Database table Phase 2 writes deepfake scores and phone data into |
| Inngest pipeline | Not built | Async job runner that orchestrates the analysis steps |
| `MediaUploader` component | Not built | Audio/video file upload UI |
| `useMediaAnalysis` hook | Not built | Client-side polling for async analysis results |
| Whisper integration | Not built | Audio transcription (transcripts are what phone extraction runs on) |
| Media presign/status API routes | Not built | R2 presigned upload URLs + job status polling |

**Do not enable feature flags until Phase 1 is complete.**

---

## 1. Third-Party Account Setup

### 1A. Reality Defender (Primary Deepfake Detection)

| | |
|---|---|
| **What** | Ensemble multi-model deepfake detection for audio and images |
| **Free tier** | 50 scans/month, no credit card required |
| **Limitations** | Video detection NOT available on free tier (audio + image only) |
| **Cost beyond free** | Enterprise pricing (contact sales) |

**Steps:**

1. Go to [realitydefender.com/api](https://realitydefender.com/api)
2. Click "Get Started" and create an account
3. Once logged in, go to **Settings > Manage API Keys**
4. Create a new API key
5. Copy the key — you'll need it for `REALITY_DEFENDER_API_KEY`

**Verify it works:**

```bash
# Quick smoke test (replace with your key)
curl -X POST https://api.realitydefender.com/api/v1/upload \
  -H "X-API-KEY: your_key_here" \
  -F "file=@test_audio.mp3"
```

If you get a `requestId` back, the account is active.

### 1B. Resemble AI (Fallback Deepfake Detection)

| | |
|---|---|
| **What** | DETECT-3B Omni model for audio/video/image deepfake detection |
| **Free tier** | 2 free web submissions only. API usage is pay-as-you-go from day one |
| **Cost** | Flex Plan: $2.40 per 1,000 minutes (~$0.014 per 5-second clip) |

This is the **fallback** provider — only used if Reality Defender is unavailable or errors out. You can skip this initially and add it later.

**Steps:**

1. Go to [app.resemble.ai](https://app.resemble.ai) and create an account
2. Navigate to [app.resemble.ai/account/api](https://app.resemble.ai/account/api)
3. Generate an API token
4. Copy the token — you'll need it for `RESEMBLE_AI_API_TOKEN`
5. Add credits to your account (Flex Plan) if you want the fallback active

**Note:** You can set `REALITY_DEFENDER_API_KEY` and leave `RESEMBLE_AI_API_TOKEN` empty. The system will use Reality Defender only with no fallback. If Reality Defender fails and Resemble isn't configured, the deepfake step will error and the pipeline will continue without a deepfake score.

### 1C. Twilio (Phone Number Intelligence)

| | |
|---|---|
| **What** | Lookup v2 API — carrier, line type, VoIP detection for phone numbers |
| **Free tier** | Basic validation is free. Line Type Intelligence is $0.008/lookup |
| **Typical cost** | ~$0.016/analysis (average 2 phone numbers per transcript) |

**Steps:**

1. Go to [twilio.com/try-twilio](https://www.twilio.com/try-twilio) and create an account
2. After verification, go to the [Twilio Console](https://console.twilio.com)
3. Your **Account SID** and **Auth Token** are on the console dashboard
4. Copy both — you'll need them for `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`

**Verify it works:**

```bash
# Test with a known AU number format (replace SID and TOKEN)
curl -X GET "https://lookups.twilio.com/v2/PhoneNumbers/+61412345678?Fields=line_type_intelligence" \
  -u "ACCOUNT_SID:AUTH_TOKEN"
```

You should get back JSON with `lineTypeIntelligence.type` = `"mobile"` and `lineTypeIntelligence.carrierName` = a carrier name.

**Important:** Twilio trial accounts can only look up verified phone numbers. For production use, upgrade to a paid account (no minimum spend, pay-per-lookup).

---

## 2. Database Migration

### 2A. Phase 1 Migration (migration-v4.sql) — NOT YET CREATED

Phase 1 must create the `media_analyses` table. When built, it should include these nullable Phase 2 columns:

```sql
CREATE TABLE media_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Phase 1 columns
  job_id TEXT UNIQUE NOT NULL,
  r2_key TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('audio')),
  status TEXT NOT NULL DEFAULT 'pending',
  transcript_scrubbed TEXT,
  verdict TEXT,
  confidence REAL,
  summary TEXT,
  red_flags JSONB DEFAULT '[]',
  next_steps JSONB DEFAULT '[]',
  duration_seconds REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Phase 2 columns (nullable, populated later)
  deepfake_score REAL,
  deepfake_provider TEXT,
  deepfake_raw JSONB,
  phone_carrier TEXT,
  phone_type TEXT
);

ALTER TABLE media_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage media analyses"
  ON media_analyses FOR ALL
  USING (auth.role() = 'service_role');
```

### 2B. Phase 2 Migration (migration-v5.sql) — READY

Run this in the Supabase SQL Editor **after** migration-v4 has been applied:

**File:** `supabase/migration-v5.sql`

This creates:
- Index on `media_analyses.deepfake_score` (partial, only non-null rows)
- `phone_lookups` table with RLS (service role only)
- Index on `phone_lookups.analysis_id`
- Widens `media_type` CHECK constraint to include `'video'`

**To apply:**

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Paste the contents of `supabase/migration-v5.sql`
4. Click **Run**
5. Verify: run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'phone_lookups';` — should return 1 row

---

## 3. Environment Variables

### 3A. Local Development (.env.local)

Add these to your `.env.local` file:

```bash
# ── Phase 2 Feature Flags (keep OFF until ready) ──
NEXT_PUBLIC_FF_DEEPFAKE=false
NEXT_PUBLIC_FF_PHONE_INTEL=false
NEXT_PUBLIC_FF_VIDEO_UPLOAD=false

# ── Phase 2: Deepfake Detection ──
REALITY_DEFENDER_API_KEY=rd_your_key_here
RESEMBLE_AI_API_TOKEN=            # Optional fallback — leave empty if not using

# ── Phase 2: Phone Intelligence ──
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
```

### 3B. Vercel Production

In your Vercel project dashboard:

1. Go to **Settings > Environment Variables**
2. Add each variable for the **Production** environment:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_FF_DEEPFAKE` | `false` | Set to `true` when ready to enable |
| `NEXT_PUBLIC_FF_PHONE_INTEL` | `false` | Set to `true` when ready to enable |
| `NEXT_PUBLIC_FF_VIDEO_UPLOAD` | `false` | Set to `true` when ready to enable |
| `REALITY_DEFENDER_API_KEY` | Your API key | Required for deepfake detection |
| `RESEMBLE_AI_API_TOKEN` | Your API token | Optional fallback provider |
| `TWILIO_ACCOUNT_SID` | `ACxxxx...` | Required for phone intelligence |
| `TWILIO_AUTH_TOKEN` | Your auth token | Required for phone intelligence |

**Important:** `NEXT_PUBLIC_` variables are embedded at build time. Changing them requires a redeploy. Non-`NEXT_PUBLIC_` variables (the API keys) take effect immediately via serverless function cold starts.

---

## 4. Privacy Policy Updates

Before enabling any flags, update your privacy policy / terms with these disclosures:

### 4A. Deepfake Detection Disclosure

> Audio and video files may be analysed by third-party AI services for deepfake detection. Files are transmitted securely via HTTPS and are not retained by these providers after analysis.

### 4B. Phone Number Lookup Disclosure

> Phone numbers mentioned in submitted recordings may be checked against telecommunications databases to identify VoIP, carrier, and line type information. Only the last three digits of any phone number are stored, and only for recordings confirmed as scams.

### 4C. Cross-Border Data Processing (APP 8)

Add these to your existing list of cross-border processors:

| Service | Country | Purpose |
|---|---|---|
| Reality Defender | United States | Audio/image deepfake detection |
| Resemble AI | Canada | Fallback deepfake detection |
| Twilio | United States | Phone number carrier/type lookup |

These join your existing processors: Anthropic (US), OpenAI (US), Google (US), Cloudflare (US).

### 4D. Update `docs/privacy-flow.md`

Add to the "Third-Party Services" table:

| Service | Data Shared | Purpose |
|---|---|---|
| Reality Defender | Audio/video file (in-transit only) | Deepfake detection |
| Resemble AI | Audio/video URL (in-transit only) | Fallback deepfake detection |
| Twilio Lookup | Phone numbers from transcript | Carrier/VoIP identification |

Add to the "What We Store (HIGH_RISK Verdicts Only)" table:

| Data | Purpose | Retention |
|---|---|---|
| Deepfake score + provider | Voice authenticity assessment | Indefinite |
| Phone lookups (last 3 digits only) | Carrier/VoIP risk indicators | Indefinite |

---

## 5. Vercel Configuration

### 5A. Function Timeout

The deepfake detection step can take 30-60 seconds (Reality Defender polls for results). Ensure your Inngest functions have adequate timeout:

- Vercel Hobby: 60s max function duration (tight but workable)
- Vercel Pro: 300s max (comfortable)

If on Hobby, the Resemble AI fallback (up to 60s polling) may time out. Reality Defender's SDK handles polling internally and is typically faster.

### 5B. `/tmp` Storage

Reality Defender's SDK requires a file path on disk. Inngest steps write the media buffer to `/tmp/` during the deepfake step.

- Vercel Hobby: ~250MB `/tmp`
- Vercel Pro: ~500MB `/tmp`

Audio files (max 50MB) and video files (max 200MB) fit within either limit. Files are deleted immediately after the deepfake step completes.

### 5C. Content Security Policy

If you restrict `connect-src` in your CSP headers, add these domains:

```
connect-src: ... https://api.realitydefender.com https://app.resemble.ai https://lookups.twilio.com
```

These are server-side API calls (not browser), so this only matters if your CSP applies to API routes.

---

## 6. Cost Budget

### Per-Analysis Cost (all features enabled)

| Service | Cost | Notes |
|---|---|---|
| Whisper transcription (3 min avg) | ~$0.018 | Phase 1, $0.006/min |
| Claude Haiku analysis | ~$0.001 | Phase 1, ~800 tokens |
| Reality Defender (free tier) | $0.00 | 50 scans/month free |
| Twilio Lookup (2 numbers avg) | ~$0.016 | $0.008/lookup |
| R2 storage (transient) | ~$0.0001 | Deleted within minutes |
| **Total per analysis** | **~$0.035** | |

### Monthly Budget at Scale

| Volume | Deepfake Cost | Phone Intel Cost | Total Phase 2 Add |
|---|---|---|---|
| 50/month | $0 (free tier) | $0.80 | $0.80 |
| 100/month | $0 (50 free + 50 overage TBD) | $1.60 | ~$1.60 |
| 500/month | Enterprise pricing | $8.00 | Contact RD sales |

### If Resemble AI Becomes Primary

If Reality Defender is unavailable and Resemble AI handles all scans:

| Volume | Resemble Cost | Notes |
|---|---|---|
| 100/month (5s avg) | ~$1.40 | $2.40/1,000 min |
| 500/month (5s avg) | ~$7.00 | |

---

## 7. Activation Sequence

Enable one flag at a time with monitoring between each.

### Step 1: Enable Deepfake Detection

```
NEXT_PUBLIC_FF_DEEPFAKE=true
```

**Verify:**
- Upload an audio file through the media analysis flow
- Check `media_analyses` table: `deepfake_score` and `deepfake_provider` should be populated
- Check the UI: `DeepfakeGauge` component should render in the result card
- Check Reality Defender dashboard: scan count should increment
- Monitor for errors in Vercel logs (search for "Reality Defender" or "deepfake")

**Wait 1 week before proceeding.**

### Step 2: Enable Phone Intelligence

```
NEXT_PUBLIC_FF_PHONE_INTEL=true
```

**Verify:**
- Upload an audio recording that mentions a phone number
- Check `phone_lookups` table: should have rows for HIGH_RISK verdicts only
- Verify phone numbers are scrubbed (e.g., `*********678` not `+61412345678`)
- Check the UI: phone risk section should appear in result card when flags exist
- Check Twilio console: Lookup usage should show
- SAFE/SUSPICIOUS verdicts should NOT create `phone_lookups` rows

**Wait 1 week before proceeding.**

### Step 3: Enable Video Upload

```
NEXT_PUBLIC_FF_VIDEO_UPLOAD=true
```

**Verify:**
- Video upload option appears in the UI mode toggle
- mp4/webm/mov files are accepted; files over 200MB are rejected
- Whisper transcription works on video files (extracts audio internally)
- Deepfake detection runs on the video's audio track
- Full pipeline completes within 120 seconds for a short video

---

## 8. Rollback

If any feature causes issues, disable it immediately:

1. Set the flag to `false` in Vercel Environment Variables
2. Trigger a redeploy (required for `NEXT_PUBLIC_` changes)
3. The feature is now completely disabled — no code paths execute

Data already written to `media_analyses` and `phone_lookups` remains intact. No cleanup needed.

To fully remove a provider:
1. Set the flag to `false`
2. Remove the API key env var
3. The provider library is never called when both the flag is off and the key is missing

---

## 9. Monitoring Checklist

Set up alerts for these:

| Signal | Where to Check | Action |
|---|---|---|
| Reality Defender 50/month limit | RD dashboard or track in app logs | Switch to Resemble AI or upgrade |
| Twilio spend > $5/month | Twilio console billing | Review analysis volume |
| Deepfake step timeout | Vercel function logs | Check provider status page |
| `phone_lookups` rows for non-HIGH_RISK | Supabase query | Bug — phone data should only store for HIGH_RISK |
| Unscrubbed phone numbers in DB | `SELECT * FROM phone_lookups WHERE phone_number_scrubbed NOT LIKE '*%'` | Privacy bug — fix immediately |

---

## Quick Reference: All New Env Vars

```bash
# Feature Flags (NEXT_PUBLIC_ = requires redeploy to change)
NEXT_PUBLIC_FF_DEEPFAKE=false          # Deepfake detection on/off
NEXT_PUBLIC_FF_PHONE_INTEL=false       # Phone intelligence on/off
NEXT_PUBLIC_FF_VIDEO_UPLOAD=false      # Video upload on/off

# Provider Credentials (server-side only, hot-swappable)
REALITY_DEFENDER_API_KEY=              # realitydefender.com/api
RESEMBLE_AI_API_TOKEN=                 # app.resemble.ai/account/api (optional)
TWILIO_ACCOUNT_SID=                    # console.twilio.com
TWILIO_AUTH_TOKEN=                     # console.twilio.com
```

## Quick Reference: Database Objects Created by Phase 2

| Object | Type | Depends On |
|---|---|---|
| `idx_media_analyses_deepfake` | Partial index | `media_analyses` table (Phase 1) |
| `phone_lookups` | Table | `media_analyses.id` FK (Phase 1) |
| `idx_phone_lookups_analysis` | Index | `phone_lookups` table |
| `media_type_check` (widened) | CHECK constraint | `media_analyses` table (Phase 1) |

## Quick Reference: New Files

| File | Type | What It Does |
|---|---|---|
| `lib/featureFlags.ts` | Config | Env-var feature flag definitions |
| `lib/realityDefender.ts` | Provider | Reality Defender SDK integration |
| `lib/resembleDetect.ts` | Provider | Resemble AI REST API integration |
| `lib/twilioLookup.ts` | Provider | Twilio Lookup v2 + AU phone extraction |
| `lib/deepfakeDetection.ts` | Abstraction | Primary/fallback provider orchestration |
| `components/DeepfakeGauge.tsx` | UI | Visual score bar (3 threshold levels) |
| `supabase/migration-v5.sql` | Migration | phone_lookups table + indexes |
