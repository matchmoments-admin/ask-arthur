# Pending manual setup — items requiring user action

Items that the 2026-05-08 db-hygiene sweep shipped behind a flag or
toggle. Each requires manual configuration outside the codebase
(dashboard click, third-party API token, GitHub secret) before the
shipped code path is fully active.

> **Note.** Each item below is also tracked as a checkbox in
> [BACKLOG.md → Database Hygiene & SPF Readiness → Active queue](../../BACKLOG.md).
> Tick them off there once the steps in this doc are complete.

---

## -1. Extension monetisation activation (3 phases, 2026-07-17)

All 8 PRs of [docs/plans/extension-monetisation.md](../plans/extension-monetisation.md)
are merged and DARK. Activation is phased and operator-driven — the full
runbook lives in the plan doc's "Activation runbook" section; summary:

- **Phase A (Hive / Facebook ads):** confirm the Hive pricing contract
  (adjust `PRICING.HIVE_AI_USD_PER_IMAGE` if ≠ $0.003), confirm
  `HIVE_API_KEY` in Vercel, flip `NEXT_PUBLIC_FF_FACEBOOK_ADS`.
- **Phase B (right-click image check — image-check v2 shape):** flip
  `NEXT_PUBLIC_FF_IMAGE_CHECK=true` **and** `FF_IMAGE_CHECK_VISION=true`
  together (vision is launch-default; both vendors braked at $5/day each);
  build v1.1.0 with `WXT_IMAGE_CHECK=true`; upload to the unlisted CWS
  listing. Then, separately and after v239 verification,
  `FF_IMAGE_CHECK_RECORDS=true` activates evidence records + the
  `/image-check/[ref]` page/PDF + `/api/v1/image-checks`. Smoke test:
  [extension-image-check-config.md](./extension-image-check-config.md).
- **Phase C (Extension Pro billing):** create the Stripe product
  (A$4.99/mo, A$49/yr) → price IDs into
  `NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY/_ANNUAL`; flip
  `NEXT_PUBLIC_FF_EXTENSION_BILLING`; rebuild with
  `WXT_EXTENSION_BILLING=true`. Test-mode e2e per
  [extension-billing-config.md](./extension-billing-config.md).

Before each consumer-flag flip: re-run advisors + the Disk-IO-budget query
per the CLAUDE.md convention.

## 0. Add `AXIOM_QUERY_TOKEN` to Vercel prod (activates the Axiom fleet watchdog)

**Why:** the `/api/cron/axiom-fleet-watch` cron (every 15 min) polls the
`ask-arthur` Axiom dataset and pages admin Telegram only on a genuinely-bad
condition (Inngest `fn.error` spike, runaway `fn.start` volume, or HTTP 5xx
spike). It needs a **query-scoped** Axiom API token — distinct from
`NEXT_PUBLIC_AXIOM_TOKEN`, which is ingest-only. Until the var is set the cron
no-ops (`{skipped: true}`), so the alerting is inert.

**Effort:** ~1 min + a redeploy. No code change.

**Steps:**

1. In Axiom: **Settings → API tokens → Create token**, scope **Query** (an
   `xaat-` API token with Query permission, or an `xapt-` personal token).
2. In Vercel: **Project → Settings → Environment Variables → Add** —
   name `AXIOM_QUERY_TOKEN`, value the token, target **Production** (Preview
   optional). It's a server secret, so leave it encrypted.
3. **Redeploy** (env vars are snapshotted at deploy time — the running cron
   won't see the new var until a fresh deploy; see the Vercel-env-snapshot
   note). The next `*/15` tick then queries Axiom for real.
4. Verify: the cron's run output should show `{checked: true, …}` instead of
   `{skipped: true}`. To test paging without waiting for a real incident,
   temporarily set `AXIOM_FLEET_5XX_THRESHOLD=1` (or trigger a 5xx) and confirm
   the Telegram DM, then revert.

**Optional tuning env vars** (sane defaults, only set to override):
`AXIOM_FLEET_ERROR_THRESHOLD` (5), `AXIOM_FLEET_PER_FN_ERROR_THRESHOLD` (3),
`AXIOM_FLEET_RUNAWAY_THRESHOLD` (300), `AXIOM_FLEET_5XX_THRESHOLD` (10).
Also requires `TELEGRAM_ADMIN_CHAT_ID` (already set for pg-stuck-query-watchdog).

---

## 1. Enable HIBP leaked-password protection (P1)

**Why:** the only remaining security advisor WARN. Supabase Auth checks
the user's password against HaveIBeenPwned at signup/change time and
rejects passwords that have appeared in a known breach. Industry
standard; SOC 2 / NIST 800-63B aligned.

**Effort:** ~30 seconds. No migration. No code change.

**Steps:**

1. Open the Supabase dashboard.
   Direct link:
   `https://supabase.com/dashboard/project/rquomhcgnodxzkhokwni/auth/providers`
2. In the left nav: **Authentication → Providers**.
3. Click **Email** to expand it.
4. Find the toggle **"Prevent use of leaked passwords"** (under "Password security" — sometimes labelled "Leaked password protection").
5. Switch it to **ON**.
6. Click **Save**.

**Verify:**

- After save, re-run the security advisor:
  ```
  mcp__supabase__get_advisors project_id=rquomhcgnodxzkhokwni type=security
  ```
  Expected result: `0` lints. The `auth_leaked_password_protection`
  WARN that was the sole remaining finding will be gone.
- Try signing up a new test user with a known-leaked password (e.g.
  `password123`) — Supabase Auth should reject it with a "compromised
  password" error.

**Rollback:** flip the toggle back OFF in the same UI. No state to undo.

---

## 2. Configure R2 DR bucket + enable daily pg_dump cron (P3)

> ⚠️ **Currently producing ZERO logical backups.** `dr-pg-dump.yml` is
> scheduled daily but `ENABLE_DR_DUMP` is unset, so every run skips.
> Confirmed 2026-07-17 (the workflow's last 5 scheduled runs all show
> `skipped`). The only backup layer today is Supabase's own PITR window —
> there is no independent, account-compromise-resistant cold copy until
> this is completed. Reclassifying the urgency here is a business call
> (P3 assumes PITR is sufficient); flagged so it's a conscious decision,
> not an oversight.

**Why:** the cold-tier DR layer. PRs #173 shipped the GitHub Actions
workflow that does `pg_dump → gzip → R2 → SHA-verify` nightly, but it's
gated on `vars.ENABLE_DR_DUMP == 'true'` so it doesn't fail nightly
while R2 isn't configured. Once enabled, RPO ~24h / RTO ~hours for
account-compromise / region-outage / post-PITR-window incidents.

**Effort:** ~30 minutes one-time setup. No code changes; no migration.
After setup, the workflow runs nightly at 17:00 UTC (= 03:00 AEST)
forever.

**Background reading:** [`docs/ops/dr-plan.md`](./dr-plan.md) §"Long-term cold".

### Step 2A — Create the R2 bucket (~10 min)

1. Open the Cloudflare dashboard:
   `https://dash.cloudflare.com/`
2. Left nav: **R2 Object Storage**. (You should already have R2 enabled
   on this account — same R2 used for the existing `evidence_r2_key` /
   `r2_image_key` buckets.)
3. Click **Create bucket**.
4. **Name:** `safeverify-dr` (the workflow defaults to reading this from
   the `R2_DR_BUCKET` secret, so any name is fine — just match step 2D).
5. **Location hint:** Asia-Pacific (closest to the Sydney Supabase region).
6. **Storage class:** Standard.
7. Click **Create bucket**.

### Step 2B — Enable Object Lock + versioning + lifecycle (~10 min)

After the bucket exists, configure three retention features:

**Object Lock (Compliance mode, 30-day default retention):**

1. In the new bucket, go to **Settings → Object Lock**.
2. Toggle **Enable Object Lock**.
3. **Default retention:** `Compliance` mode, `30 days`.
4. Save. _Compliance mode is irreversible — even an authenticated user with full bucket permissions cannot delete an object until its retention period expires._

**Versioning:**

1. **Settings → Object Versioning**.
2. Toggle **Enable** (or "Suspended" → "Enabled").
3. Save.

**Lifecycle rule (delete old versions after 90 days):**

1. **Settings → Object Lifecycle Rules → Add rule**.
2. **Name:** `delete-versions-90d`.
3. **Scope:** entire bucket.
4. **Action:** "Delete previous versions of objects" after `90` days.
5. Save.

> **Why these three together:** Object Lock prevents tampering for the
> first 30 days (DR window). Versioning means an overwrite preserves the
> prior version. Lifecycle deletes old versions after 90 days so cost
> doesn't grow forever.

### Step 2C — Create an R2 API token scoped to the bucket (~5 min)

1. In R2 (still in the Cloudflare dashboard), top-right: **Manage API tokens**.
2. **Create API token**.
3. **Token name:** `SafeVerify DR Dump`.
4. **Permissions:** `Object Read & Write`.
5. **Specify bucket:** `Apply to specific buckets only` → select `safeverify-dr`.
6. **TTL:** `Forever` (or set a yearly rotation reminder).
7. **Allow IPs:** leave blank (GitHub Actions runners change IPs).
8. Click **Create API token**.

The token result page shows three values — **save them now, you can't
re-view them**:

- **Access Key ID** (short string, used as `R2_DR_ACCESS_KEY_ID`)
- **Secret Access Key** (long string, used as `R2_DR_SECRET_ACCESS_KEY`)
- _(Optional)_ the S3-compatible endpoint URL — the **Account ID** is
  the subdomain part: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

### Step 2D — Find the R2 Account ID (~30 sec)

The Account ID is shown in two places:

- The **R2 overview page** has it at the top right.
- Or extract from the endpoint URL in the token result page:
  `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` — the part before
  `.r2.cloudflarestorage.com`.

Save as `R2_ACCOUNT_ID`.

### Step 2E — Add GitHub repository secrets (~3 min)

1. Open: `https://github.com/matchmoments-admin/ask-arthur/settings/secrets/actions`
2. **New repository secret** for each of:

   | Secret name               | Value                          | Source              |
   | ------------------------- | ------------------------------ | ------------------- |
   | `R2_ACCOUNT_ID`           | `<your-cloudflare-account-id>` | Step 2D             |
   | `R2_DR_BUCKET`            | `safeverify-dr`                | Step 2A bucket name |
   | `R2_DR_ACCESS_KEY_ID`     | `<short access key>`           | Step 2C             |
   | `R2_DR_SECRET_ACCESS_KEY` | `<long secret>`                | Step 2C             |

   Note: `SUPABASE_DB_URL` is already configured for `scrape-feeds.yml`
   — don't re-add it.

3. **Save** each one. Secrets are write-only; you can't re-view them
   after creation.

### Step 2F — Set the GitHub Actions variable (~30 sec)

1. Open: `https://github.com/matchmoments-admin/ask-arthur/settings/variables/actions`
2. **New repository variable**.
3. **Name:** `ENABLE_DR_DUMP`
4. **Value:** `true`
5. Save.

This is what flips the workflow from dispatch-only to "scheduled cron also fires".

### Step 2G — Verify with a manual run (~5 min)

Before waiting overnight for the first scheduled run, trigger one
manually to confirm everything works:

1. Open: `https://github.com/matchmoments-admin/ask-arthur/actions/workflows/dr-pg-dump.yml`
2. **Run workflow** (top right of the workflow page) → **Run workflow** (green button).
3. Wait ~3-5 minutes for the run to complete.
4. Check the run output:
   - **Pre-flight verify required secrets** → all secrets present.
   - **pg_dump → gzip → sha256** → reports a size (probably tens of MB
     for the current data volume).
   - **Upload to R2** → reports the key path.
   - **Verify upload** → "Verified upload integrity" notice.
5. Open the R2 bucket in the Cloudflare dashboard. You should see one
   new object under `safeverify-dr/<today-utc-date>/safeverify-<ts>-<sha-prefix>.dump`.

After this manual verify, the scheduled cron at **17:00 UTC nightly**
(= 03:00 AEST) takes over.

**Rollback:** set `ENABLE_DR_DUMP=false` in step 2F, or delete the
variable. The scheduled cron stops running. The bucket + token + secrets
can stay in place.

---

## 3. Quarterly DR drill (P3, recurring)

**First scheduled drill:** **2026-07-01**.

This isn't a configuration step but a recurring operational task. Per
[`docs/ops/dr-plan.md`](./dr-plan.md) §"Quarterly drill steps":

1. Pick a random PITR timestamp within the last 24h.
2. Restore to a sibling Supabase project (`safeverify-drill-YYYYMM`).
3. Smoke-test the restored project (the smoke-test script doesn't exist
   yet — write `apps/web/scripts/smoke.ts` as part of the first drill).
4. Document the drill in `docs/ops/dr-plan.md` "Drill log".
5. Tear down the drill project within 24h to avoid Supabase compute
   charges.

**Calendar reminder:** 1st of January / April / July / October.

---

## Status snapshot

After completing items 1 + 2 above:

- Security advisor: **0 lints** (currently 1: HIBP toggle).
- Cold-tier DR layer: **active** with 30-day Object Lock, 90-day version
  retention, daily 17:00 UTC dump cycle.

The first DR drill (item 3) closes the "DR has never actually been
exercised" gap that's mentioned in `docs/ops/dr-plan.md` §"First-time-
needed rule".
