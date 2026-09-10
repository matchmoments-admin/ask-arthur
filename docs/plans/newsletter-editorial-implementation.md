# Newsletter editorial implementation

Implementation follows the 10 September newsletter review. Extend the existing weekly publication, preserving subscriber confirmation, suppression, cost telemetry and explicit publication decisions.

North Star: serves Australian consumers now; strengthens Teach and use of the free checker; extends the existing React Email/Resend path; success is issue-attributed completed checks and repeat use.

## Sequence

1. Source-date windows and truthful claims/counts.
2. Public evidence candidates and source health; private inbound research remains separate.
3. Arthur’s Watch template with matched Arthur’s Take, tells, actions and safe sources.
4. Durable drafts, revision approval, manual sending and recipient receipts.
5. Tests, migration validation, rendering and deployment checks.

The weekly cron prepares only; it does not send. Source attribution from an inbound recipient tag is insufficient for public inclusion (ADR-0021). Inbound bodies and unverified observations are not candidates in this first release. Existing extraction continues; regulator quarantine remains a separate editorial task.

Use the existing admin authentication and same-origin mutations. Service clients are constructed in API routes and passed into newsletter functions. Never send from preview deployments. Production sending additionally requires NEWSLETTER_SEND_ENABLED=true. The first inbox test requires the operator to deliberately initiate a send; implementation tests use a mocked provider.

## Implemented in this branch

- `apps/web/lib/newsletter/prepare.ts` selects source-dated, public Arthur’s Take, regulator and operator-reviewed clone candidates for one complete UTC week. Its bounded sample is disclosed. It does not generate incident counts or trend badges.
- `apps/web/app/api/cron/weekly-email/route.ts` prepares the issue only. Repeated preparation keeps existing edits through the unique window and insert-on-conflict-ignore.
- `/admin/newsletter` offers evidence links, candidate selection, editable stories and saved HTML preview. Regulator candidates require the editor to write the explanation and action; placeholder copy cannot pass approval.
- The admin POST checks authentication and same origin. Saving increments revision and clears approval; approval checks source eligibility and freezes HTML/plain text/sender. Sending is a separate deliberate action.
- `start_newsletter_issue` serialises recipient snapshot creation against edits; `claim_newsletter_delivery` checks the send brake and current subscriber/suppression state, then atomically claims each recipient once. Unknown provider outcomes remain held rather than being automatically retried.
- `sendNewsletterBatch` gates on production plus `NEWSLETTER_SEND_ENABLED=true`, processes at most 20 recipients per action, records accepted provider IDs and cost, and keeps personalised HTML/plain-text opt-out links.
- `checkNewsletterEvidence` rechecks public eligibility at approval and each send invocation. It fails closed if evidence is withdrawn or cannot be read.

## Rollout and operational review

1. Apply v305 to an empty Supabase preview and run `supabase/tests/newsletter-issues.sql`. Validate simultaneous recipient claims separately.
2. Run targeted tests, typecheck, lint and web production build. Render a sample at 375px and 800px; an HTML screenshot does not prove Outlook/Gmail rendering or inbox delivery.
3. Apply the additive migration before deploying the app, regenerate DB types from the applied schema, and verify advisors. Keep sending disabled until the saved production draft has been reviewed.
4. Open `/admin/newsletter`, prepare a draft, select distinct relevant stories, edit and save. Check sources and the saved preview. Approve only that revision.
5. Before broad distribution, use “Send saved issue to my test inbox” after approval. It sends only to ADMIN_TEST_EMAIL (or the established operator fallback), once per revision, with a global 20-test rolling-day budget. Check a real inbox before acknowledging the audience-send checkbox. The database requires a successful test receipt for the revision before audience sending.
6. Enable production sending only after the controlled inbox check. Use the explicit send action; repeat it for pending recipients. Accepted means the provider returned an ID, not that an inbox received it.
7. A `sending` delivery without a receipt requires reconciliation in the provider dashboard. Do not reset it to pending merely because time elapsed: the provider may have accepted it. Record its provider ID/status only after establishing the outcome. Leave uncertainty held; no automated retry or timeout-based reclamation is implemented.

Preparation-to-publication gates: public `feed_items` + eligible Take or reviewed Clone → private candidate snapshot → saved editor copy → evidence recheck/approval → frozen render → manual send → atomic eligible recipient claim → provider receipt. Inbound observations do not cross the public-candidate gate in this release.

## Remaining source expansion

Close ADR-0021’s inbound sender-attribution gap before using email-derived claims publicly. Reconcile WA ScamNet source classification, add an internal observation/coverage-gap review view, and require primary corroboration before admitting a candidate. These are intentionally still research/verification work; no claim is made that this branch authenticates incoming email senders or automates regulator editorial writing.

The test-send control is implemented; actually sending and checking a real inbox and newsletter-attributed completed-check measurement remain launch follow-ups. Existing UTM parameters identify the newsletter campaign but do not alone prove a completed check.
