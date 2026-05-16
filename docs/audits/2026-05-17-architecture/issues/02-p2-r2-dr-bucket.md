---
severity: P2
title: "[P2] Configure R2 DR bucket + secrets to unblock nightly pg_dump"
labels: severity:p2, ready-for-human, domain:dr, ops
action_type: ops
estimated_time: 30 minutes
---

## Summary

The `dr-pg-dump` GitHub Actions workflow (PR #173) is shipped but gated on `ENABLE_DR_DUMP == 'true'` GitHub variable. It currently does nothing because the R2 bucket and credentials aren't configured. RPO is effectively the Supabase managed-backup window (~24h on Pro) with no off-vendor copy.

## Impact

- **Compliance:** no off-vendor backup → single point of failure on Supabase. If the Supabase account is compromised or accidentally deleted, no path to recovery.
- **Audit posture:** B2B contracts increasingly ask for off-vendor backup attestation. Currently can't answer truthfully.
- **Tampering window:** without Object Lock + versioning, an attacker with write access could destroy backups.

## Fix

Per `docs/ops/pending-manual-setup.md` §2:

1. **Create R2 bucket** (Cloudflare dashboard):
   - Name: `ask-arthur-dr-pg-dumps`
   - Region: APAC (Sydney) for jurisdiction
   - Object Lock: Compliance mode, 30 day retention
   - Versioning: enabled
   - Lifecycle rule: delete old versions after 90 days

2. **Mint API token** (Cloudflare R2 → Manage R2 API Tokens):
   - Permissions: Object Read & Write on the DR bucket only
   - TTL: indefinite (rotate annually)

3. **Add GitHub secrets** to `matchmoments-admin/ask-arthur`:
   - `R2_ACCOUNT_ID`
   - `R2_DR_BUCKET` (= `ask-arthur-dr-pg-dumps`)
   - `R2_DR_ACCESS_KEY_ID`
   - `R2_DR_SECRET_ACCESS_KEY`

4. **Set GitHub variable** `ENABLE_DR_DUMP=true`

5. **Trigger workflow manually once** to verify (Actions → dr-pg-dump → Run workflow)

6. Confirm artifact in R2 + record in audit log

## Verification

- `gh run list --workflow dr-pg-dump --limit 1` shows green
- Object visible in R2 bucket with correct retention policy
- Object Lock prevents delete attempt: `aws s3api delete-object` should fail with `ObjectLockMode` error

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P2] Configure R2 DR bucket + secrets to unblock nightly pg_dump" \
  --label "severity:p2,ready-for-human,ops" \
  --body-file 02-p2-r2-dr-bucket.md
```
