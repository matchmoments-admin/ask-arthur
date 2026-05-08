# Disaster recovery plan

Covers Postgres (Supabase managed), Storage (R2), and the Inngest event log. RPO and RTO targets per layer; quarterly drill cadence; restore runbook.

Last updated: 2026-05-08.

> **First-time-needed rule.** The first time you actually need this is the worst time to discover env-var rot or a bucket-permission gap. Run the quarterly drill (see §Drills) — every drill exposes one thing the runbook didn't anticipate.

---

## Threat model

What we're recovering from, in priority order:

1. **Operator error** — bad migration, accidental DELETE, schema mistake. Recovered via PITR.
2. **Application bug** — a code path silently corrupts data over hours/days. Recovered via PITR (need to identify the corruption-start timestamp).
3. **Supabase region outage** — Sydney region down. Recovered via cold-tier dump in R2 to a sibling Supabase project (different region).
4. **Account compromise** — attacker gains Supabase admin. Recovered via Object-Lock'd R2 backups (immutable for 30d) restored to a fresh project.
5. **Storage corruption** — R2 bucket loss. Versioning + Object Lock makes this very low risk; mitigated by lifecycle rule.

---

## Layered DR

| Layer | RPO | RTO | Mechanism | Coverage |
|---|---|---|---|---|
| Hot | seconds | minutes | Supabase managed primary, WAL streaming | Single-table corruption, single-row fat-finger |
| Recent | ~2 min | hours | Supabase PITR (7-day window on Pro; 28-day configurable) | Bad migration, multi-hour corruption |
| Long-term cold | 24h | 1–2 days | Daily logical dump → R2 (Object Lock Compliance, 30-day immutability + versioning) | Account compromise, region outage, post-PITR-window incidents |
| Cross-region | hours | days | Quarterly logical replica restore drill (separate Supabase project, different region) | Supabase region outage; runbook validation |

### PITR (Supabase Pro)

Configured on project `rquomhcgnodxzkhokwni`. WAL archives every ~2 minutes. RPO is "seconds to a couple of minutes" — what's NOT in the WAL is lost.

**RTO is the unintuitive part.** Supabase docs explicitly note PITR restore is *not* faster than daily-snapshot restore — often slower because WAL replay time scales with how far you are from the last base snapshot. For an 18h-stale incident, replaying 18h of WAL can take longer than restoring an 18h-old daily snapshot.

**PITR is for precision, not speed.** Use it when you need a specific timestamp (e.g. "restore to 2 minutes before the bad migration"); use the cold-tier dump when you need fast bulk recovery.

PITR retention is currently 7 days. **Revisit when:** any single feature's deployment cycle exceeds a week (today: most features ship within 2-3 days).

### Long-term cold (planned — not yet shipped)

Daily logical dump via GitHub Actions cron, written to R2 with:
- Object Lock Compliance mode, 30-day retention (immutable; cannot delete via API)
- Bucket versioning ON (object overwrite preserves prior versions)
- Lifecycle: delete versions >90 days

Naming: `safeverify-dr/<utc-date>/dump-<sha256>.sql.gz`. SHA256 in filename catches in-flight corruption.

**Status: NOT YET SHIPPED.** Tracked as Phase 9.2 of the data-model improvement plan. Today's only DR is Supabase PITR (7d) + their daily backups (varies). Implement before any B2B contract ships — SOC 2 will require it.

### Storage (R2)

Supabase Storage is **not** covered by Postgres PITR. Treat as its own DR domain:
- Object versioning ON (currently default)
- Lifecycle rules: 90-day version retention
- Quarterly drill includes a R2 bucket restore drill — pick a random object, delete it, restore from version history.

---

## Drill cadence

Quarterly. Calendar reminder for the 1st of January / April / July / October.

### Quarterly drill steps

1. **Pick a random PITR timestamp** within the last 24h.
2. **Restore to a sibling Supabase project** (`safeverify-drill-YYYYMM`). Use the Supabase dashboard restore-from-PITR flow.
3. **Time the restore.** Expect 30–60 min for our current data volume (<100MB main tables).
4. **Smoke-test the restored project:**
   - Connect via supabase-js with a fresh anon key
   - Run the regression smoke set (TBD: `apps/web/scripts/smoke.ts` doesn't exist yet — Phase 9.3 deliverable)
   - Confirm RLS still enforces (`SELECT count(*) FROM scam_reports` as anon should work; as anon-with-no-RLS-bypass should return 0 rows)
   - Confirm a representative RPC works (e.g. `search_charities('red cross', 3)`)
5. **Document the drill** in this file's drill log (below) with date, restore time, and any unexpected findings.
6. **Tear down the drill project** within 24h to avoid Supabase compute charges.

### Drill log

| Date | RPO chosen | Restore RTO | Unexpected findings |
|---|---|---|---|
| (none yet) | | | |

First scheduled drill: **2026-07-01** (next quarter boundary post-doc-creation).

---

## Incident runbook

When you actually need DR:

### Stage 1: Containment (first 15 min)
1. **Stop the bleed.** If a bad migration is mid-rolling-deploy, pause Vercel deploys (`vercel pause` in dashboard). If a bot is mass-writing bad data, kill the Inngest function (`/admin/inngest`).
2. **Snapshot current state.** Even if everything's broken, a `pg_dump` of the current database via `mcp__supabase__execute_sql` captures forensic state. Write to R2 manually with a `forensic-<timestamp>` prefix.
3. **Decide PITR vs cold-tier.** PITR if the corruption is <7 days old AND you know the start timestamp. Cold-tier (when shipped) if either condition fails.

### Stage 2: Restore (30 min — 4h)
4. **PITR path:** Use the Supabase dashboard restore-to-point-in-time flow. RPO = 2 minutes before the chosen timestamp.
5. **Cold-tier path:** Spin up a fresh Supabase project. `psql ... < safeverify-dr/<date>/dump.sql.gz`. Wait for completion.
6. **Validate before swap:** Run the smoke set against the restored project. Confirm row counts, key RPCs, and at least one user-facing flow.

### Stage 3: Cutover (15 min)
7. **Update `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_*`** in Vercel project settings. Trigger a re-deploy.
8. **Update Inngest signing keys** in the Inngest dashboard if the project changed.
9. **Smoke-test the live site.** `/api/analyze` round-trip; one bot ingest; one extension scan.

### Stage 4: Post-incident
10. **Five-whys post-mortem.** Document in `docs/incidents/<date>-<short-name>.md`.
11. **Add a regression test** that would have caught the trigger event.
12. **Update this runbook** if anything in the procedure was wrong.

---

## Things this plan deliberately does NOT cover

- **Multi-region active-active.** Beyond our scale and complexity budget. Single primary in Sydney is sufficient for current SLA targets.
- **Hot standby in a different region.** Supabase doesn't currently support cross-region read replicas for self-serve customers. Cold-tier dump is the alternative.
- **Bot platform DR.** Telegram / WhatsApp / Slack / Messenger bots are stateless re-registrations from `/api/bot-webhook` — re-pointing the webhook URL is the entire recovery flow.
- **Vercel platform incident.** Our recovery posture against a Vercel outage is "wait it out" — Vercel uptime is part of our SLA definition.
- **R2 platform incident.** Same — Cloudflare R2 uptime is part of our SLA. Object Lock + versioning is for malicious-deletion DR, not platform DR.

---

## Open items (not yet shipped)

Tracked in the data-model improvement plan, Phase 9:

- [ ] **Phase 9.2:** Daily logical dump → R2 with Object Lock (GitHub Actions cron). Currently relying solely on Supabase PITR.
- [ ] **Phase 9.3:** First quarterly drill (2026-07-01). Authors a `apps/web/scripts/smoke.ts` smoke set as a deliverable.
- [ ] **Phase 9.4:** R2 bucket DR runbook — versioning ON, 90d lifecycle, drill steps.

---

## References

- [Supabase: Manage PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)
- [Supabase: How long does PITR restore take?](https://supabase.com/docs/guides/troubleshooting/how-long-does-it-take-to-restore-a-database-from-a-point-in-time-backup-pitr-qO8gOG)
- [Cloudflare R2 Object Lock](https://developers.cloudflare.com/r2/buckets/object-lock/)
- BACKLOG.md → "Database Hygiene & SPF Readiness" (residual ops items)
- `~/.claude/plans/prancy-strolling-dongarra.md` (Phase 9 — DR / PITR / backups)
