---
severity: P1
title: '[P1] Enable Supabase Auth "Prevent use of leaked passwords" (HIBP)'
labels: severity:p1, ready-for-human, domain:auth, security
action_type: ops
estimated_time: 30 seconds
---

## Summary

Supabase Auth's "Prevent use of leaked passwords" (HIBP integration) is OFF in the prod dashboard. This is the sole remaining `security` advisor WARN flagged in the 2026-05-08 db-hygiene sweep.

## Impact

- Users can currently sign up or change their password to a value that's already in HaveIBeenPwned's compromised-password corpus.
- Risk concentration: high-value accounts (admins, B2B keyholders) are the most likely targets of credential-stuffing.
- Low effort to fix; no code change.

## Evidence

- `docs/ops/pending-manual-setup.md` §1
- Last `mcp__supabase__get_advisors` run (type=security) returns this as the only outstanding WARN

## Fix

1. Open Supabase dashboard → Authentication → Settings → Password Strength
2. Toggle **"Prevent use of leaked passwords"** ON
3. Re-run `mcp__supabase__get_advisors` (type=security) to confirm zero lints
4. Close this issue

## Verification

```
# After flipping the toggle, the security advisor list should be empty:
mcp__supabase__get_advisors --type security
```

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P1] Enable Supabase Auth \"Prevent use of leaked passwords\" (HIBP)" \
  --label "severity:p1,ready-for-human,security" \
  --body-file 01-p1-hibp-toggle.md
```
