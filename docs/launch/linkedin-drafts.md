# Manually launch LinkedIn drafts

Implemented on 2026-09-08. Migration v304 is applied to production and the production manual-publish flag is configured. Application rollout is tracked in [PR #1126](https://github.com/matchmoments-admin/ask-arthur/pull/1126). No live post has been created by this work.

## Using it

1. Open **Admin → LinkedIn drafts** after deployment and sign in as an admin.
2. Choose one of the four starter drafts or create a new one. Edit the title (internal only) and post text, then **Save draft**.
3. Review the plain-text preview. Saving never schedules or publishes anything.
4. When ready, choose **Review for publishing**, check the destination and text, then **Publish now**. **Keep as draft** cancels the review.
5. Open the returned LinkedIn link to verify visibility. A successful API receipt is not proof that LinkedIn displays the post in its feed.

Posts go to Ask Arthur’s company page (`urn:li:organization:114874091`). The starter copy uses company voice and existing signup links, with no placeholders for unpublished issues. Publish the signup promotion only after completing the newsletter release acceptance. This initial version supports plain-text posts, with URLs in the text; images, PDF attachments and scheduled publishing are not implemented.

## Safety and failure behaviour

`requireAdmin()` protects the page and every route. Mutation routes require a matching Origin. Saving uses the saved revision and draft status, so another editor cannot silently overwrite a newer version. The publish route requires an explicit confirmation and claims the saved revision atomically before calling LinkedIn. It sends the saved database text, ignoring any caller-supplied text or author.

A publishing or uncertain row cannot be edited or sent again through the studio. Timeouts, missing receipts and provider failures are never automatically retried. If LinkedIn accepts the post but storing its receipt fails, the response includes the post link and warns the operator to retain it. If the whole response is lost, check LinkedIn directly. Do not copy an uncertain draft into a new draft to retry blindly.

For an unresolved attempt, an operator must inspect the company page and the relevant LinkedIn API records. If a matching post exists, record its verified URN and mark the row published. If absence has been established and the original route has finished (wait at least two minutes), reset that one row to draft while incrementing its version, retaining the original attempt timestamp in the incident note. Any reset should be recorded with the checking operator and evidence. The studio intentionally has no one-click reset that could produce a duplicate.

## Deployment

- Apply additive migration v304 through the recorded database deployment workflow, verify RLS/advisors and regenerate schema-derived types. It does not depend on v303’s newsletter columns.
- Set the existing LinkedIn credentials and the exact company-page URN in the production server environment. Local configuration has this URN and credentials; that does not prove they are configured on Vercel or still valid.
- Set `LINKEDIN_STUDIO_PUBLISH_ENABLED=true` only for production. The route independently checks `VERCEL_ENV=production`; previews cannot publish. No cron or queue is added.
- Verify admin login, saving, reloading, review cancellation and that a preview rejects publish requests. Enabling the setting alone sends nothing.
- The founder chooses the first live post and time. Do not use an actual public post as an automated smoke test.
- Rollback: disable the studio flag and retain drafts/receipts. Existing unrelated LinkedIn publishers are unchanged.

## Evidence and API references

Unit tests cover author/environment restrictions, admin and origin checks, explicit confirmation, storage failures, saved-text integrity, competing claims, uncertain outcomes and receipt persistence failure. A disposable PostgreSQL test applies v304 twice and checks seed preservation, grants, repeated claims and stale updates. Production database validation passed; live LinkedIn publication remains a founder-chosen action.

The shared client uses LinkedIn’s [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06). The studio escapes reserved [little-text characters](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format?view=li-lms-2026-07) so typed text is not interpreted as mention syntax. It does not log provider response bodies or credentials.

Local verification on 2026-09-08: 27 LinkedIn tests passed. Browser checks with mocked storage/provider responses verified edit/save, review cancellation, one explicit publish request and a 390px mobile layout without horizontal overflow. No live LinkedIn request was used for these checks.

Final production build and scoped lint passed after the draft studio changes. Database migration was subsequently applied after Supabase preview lifecycle and concurrency checks. External publishing was not run.
