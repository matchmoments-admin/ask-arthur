# Small-start launch execution

Started 2026-09-07 from main `2ecedff7`, on `codex/newsletter-launch-readiness`.

## Scope

Arthur's Watch strengthens Teach and the free consumer checking loop for Australian readers. Reuse the subscriber store, Resend, existing checking/reporting routes and weekly review panel. Measure confirmed signups, useful checks, returning use and paid-pilot conversion. Brand Monitor remains the first paid offer; workshops are the fallback if buyer acceptance takes longer. No revival of parked products.

## Sequence and status

| Stage | Work                                                                                  | Exit evidence                                                       | Status                                                                 |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1     | Durable signup, ownership confirmation, suppression and reliable send accounting      | Negative regressions + SQL lifecycle tests + build                  | Implemented; 33 email tests, SQL lifecycle, typecheck and build passed |
| 2     | Core web/email and Brand Monitor regression checks                                    | Targeted tests, explicit live acceptance gaps                       | Local checks complete; live acceptance outstanding                     |
| 3     | Four newsletter drafts, distribution copy, pilot offer, interview guide and scorecard | Reviewable launch kit with original/synthetic examples              | Drafted in launch-kit.md and monetisation-and-scorecard.md             |
| 4     | Preview/deployed schema and controlled inbox acceptance                               | Migration/advisor evidence, delivered/confirmed/unsubscribed trace  | Requires connected environment and a designated controlled inbox       |
| 5     | Founder-approved publication, outreach and pilot delivery                             | Actual recipients/contacts, scheduled dates, explicit send approval | Not started                                                            |

The [42 launch tasks and 52 review packets](review-baseline/small-start-monetisation-and-tasks.md) are the master backlog. The archived review is a dated snapshot, not a statement of current production state. This implementation follows dependencies, beginning with the promoted surfaces. No claim of production readiness is made from local tests. Founder conversations, actual publications and customer outcomes cannot be replaced with code changes.

## Deliverables

- [Launch kit](launch-kit.md): four issue drafts, social posts, partner introduction and later video experiment.
- [Commercial plan and scorecard](monetisation-and-scorecard.md): pilot offer, interview guide, four-week sequence and remaining gaps.
- [Release acceptance](release-acceptance.md): evidence, deployment dependencies, controlled inbox steps and rollback.
- [Read-only live baseline](readiness-baseline.json): aggregate schema and advisor observations; no subscriber addresses.
