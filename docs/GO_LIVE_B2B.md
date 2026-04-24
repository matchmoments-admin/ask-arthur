# B2B Corporate Platform — Go-Live Steps

Step-by-step guide to deploy the corporate onboarding and go-to-market features built in Phase 11c.

---

## Prerequisites

- Supabase project access (SQL editor)
- Vercel project settings (environment variables)
- ABR API GUID (free from abr.business.gov.au)
- Slack webhook URL for lead notifications (optional)

---

## Step 1: Run Database Migrations

Apply these migrations in order via **Supabase Dashboard > SQL Editor**:

### Migration v55: Organizations & Multi-Tenancy

```
File: supabase/migration-v55-organizations.sql
```

Creates:

- `organizations` table (UUID PK, name, slug, ABN, sector, tier, status)
- `org_members` table (6-role RBAC: owner/admin/compliance_officer/fraud_analyst/developer/viewer)
- `org_invitations` table (hashed tokens, 7-day expiry)
- `org_id` column on `api_keys` (nullable FK, backward-compatible)
- RLS policies for org-scoped access
- RPCs: `create_organization`, `get_user_org`, `generate_org_api_key`
- Updated timestamp trigger on organizations

**Verify after running:**

```sql
SELECT * FROM organizations LIMIT 1;  -- should return empty, no error
SELECT * FROM org_members LIMIT 1;
SELECT column_name FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name = 'org_id';
```

### Migration v56: Corporate Leads

```
File: supabase/migration-v56-leads.sql
```

Creates:

- `leads` table (name, email, company, ABN, sector, source, score, status, nurture tracking)
- Indexes for email, status, source, nurture scheduling
- Service-role only RLS
- Updated timestamp trigger

**Verify after running:**

```sql
SELECT * FROM leads LIMIT 1;  -- should return empty, no error
```

---

## Step 2: Set Environment Variables

Add to **Vercel Project Settings > Environment Variables** (Production + Preview):

### Required

```env
# Feature flags to enable B2B features
NEXT_PUBLIC_FF_MULTI_TENANCY=true
NEXT_PUBLIC_FF_CORPORATE_ONBOARDING=true
```

### Required for ABN Verification

```env
# Australian Business Register API
# Get free GUID at: https://abr.business.gov.au/Tools/AbnLookup
ABN_LOOKUP_GUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Optional (Recommended)

```env
# Slack webhook for lead notifications
SLACK_WEBHOOK_LEADS_URL=https://hooks.slack.com/services/xxx/xxx/xxx

# Site URL for invitation emails
NEXT_PUBLIC_SITE_URL=https://askarthur.au
```

### Already Set (Verify)

These should already be configured from previous deployments:

- `RESEND_API_KEY` — for nurture emails and invitation emails
- `RESEND_FROM_EMAIL` — sender address
- `CRON_SECRET` — for nurture cron authentication

---

## Step 3: Add Nurture Cron Job

Add to `vercel.json` crons array:

```json
{
  "path": "/api/cron/nurture",
  "schedule": "0 23 * * *"
}
```

This runs at 11pm UTC = 9am AEST daily, checking leads for their next nurture email.

---

## Step 4: Deploy

```bash
# Verify build passes locally first
pnpm turbo build

# Deploy to Vercel (auto-deploys on push to main)
git add -A
git commit -m "Add B2B corporate onboarding, persona dashboards, and sales funnel infrastructure"
git push origin main
```

---

## Step 5: Post-Deploy Verification

### Test the corporate onboarding flow:

1. Visit `/login` and create a new account
2. After login, verify redirect to `/onboarding`
3. Enter company details (name, optional ABN, sector)
4. If ABN entered: verify ABR lookup returns company name
5. Skip or add team invites
6. Confirm organization created, API key generated
7. Verify redirect to `/app` with org name in sidebar

### Test lead capture:

1. Visit `/banking` — verify landing page renders
2. Fill out the lead capture form
3. Verify lead appears in Supabase `leads` table
4. Verify Slack notification (if webhook configured)
5. Verify first nurture email sent (check Resend dashboard)

### Test persona dashboards:

1. Visit `/app/compliance` — verify SPF principle tracker renders
2. Visit `/app/investigations` — verify threat breakdown renders
3. Visit `/app/developer` — verify API usage charts render
4. Visit `/app/executive` — verify ROI summary renders
5. Visit `/app/team` — verify member list and invite form

### Test lead magnets:

1. Visit `/spf-assessment` — complete the 8-question assessment
2. Verify score and gap analysis display correctly
3. Submit email for detailed report — verify lead created with source="spf_assessment"
4. Visit `/compliance-calculator` — enter sample values
5. Verify penalty calculations update in real-time
6. Submit email — verify lead created with source="calculator"

### Test team management:

1. From `/app/team`, invite a team member
2. Verify invitation email received
3. Accept invitation via link
4. Verify new member appears in team list with correct role

---

## New Routes Summary

### Public Pages

| Route                    | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `/banking`               | Banking sector landing page                       |
| `/telco`                 | Telco sector landing page                         |
| `/digital-platforms`     | Digital platforms landing page                    |
| `/spf-assessment`        | SPF compliance readiness assessment (lead magnet) |
| `/compliance-calculator` | Non-compliance cost calculator (lead magnet)      |
| `/onboarding`            | Corporate onboarding wizard (auth required)       |
| `/invite/[token]`        | Invitation acceptance page                        |

### Dashboard Pages (auth required)

| Route                      | Purpose                      |
| -------------------------- | ---------------------------- |
| `/app/compliance`          | Compliance Officer dashboard |
| `/app/compliance/evidence` | Evidence export page         |
| `/app/investigations`      | Fraud Analyst dashboard      |
| `/app/developer`           | Developer dashboard          |
| `/app/executive`           | Executive summary            |
| `/app/team`                | Team management              |

### API Routes

| Route                    | Method    | Purpose                |
| ------------------------ | --------- | ---------------------- |
| `/api/org/create`        | POST      | Create organization    |
| `/api/org/members`       | GET/PATCH | Manage org members     |
| `/api/org/invite`        | POST      | Send invitation        |
| `/api/org/invite/accept` | POST      | Accept invitation      |
| `/api/leads`             | POST      | Lead capture           |
| `/api/abn-lookup`        | GET       | ABN verification       |
| `/api/cron/nurture`      | GET       | Nurture email delivery |

---

## Database Changes Summary

### New Tables (v55)

- `organizations` — corporate client entities
- `org_members` — user-to-org membership with roles
- `org_invitations` — pending team invitations

### New Tables (v56)

- `leads` — corporate sales pipeline

### Modified Tables (v55)

- `api_keys` — added `org_id` column (nullable UUID FK)

### RPCs

- `create_organization(p_abn, p_abn_entity_name, p_abn_verified, p_name, p_owner_id, p_role_title, p_sector, p_slug)` → UUID — v79 expanded the v55 5-param signature to persist ABN verification state and the onboarder's role_title.
- `get_user_org(p_user_id)` → org context (v55)
- `generate_org_api_key(p_user_id, p_org_id, p_key_hash, p_org_name)` → key record (v55)

### New Feature Flags

- `NEXT_PUBLIC_FF_MULTI_TENANCY` — gates org features
- `NEXT_PUBLIC_FF_CORPORATE_ONBOARDING` — gates onboarding wizard

---

## Rollback Plan

If issues arise, disable the feature flags to immediately hide B2B features:

```env
NEXT_PUBLIC_FF_MULTI_TENANCY=false
NEXT_PUBLIC_FF_CORPORATE_ONBOARDING=false
```

The migrations are backward-compatible — the `org_id` column on `api_keys` is nullable, so existing user-scoped keys continue to work. Existing consumer dashboard remains fully functional regardless of flag state.
