---
name: publish-to-linkedin
description: Publish a document/carousel post to the Ask Arthur LinkedIn COMPANY page through the approval-gated GitHub Actions lanes. Use when the user wants to post a deck, carousel, monthly report or launch announcement to LinkedIn, asks why a post has not gone out, or wants a new recurring/one-off LinkedIn publishing lane. Triggers "post this to LinkedIn", "put it on the company page", "publish the deck", "why hasn't it posted", "add a LinkedIn lane". For the COPY itself use the linkedin-writing skill; this one is the delivery mechanism.
---

# Publish to LinkedIn

Getting a post onto the Ask Arthur **company page**. For what the post should _say_, use `linkedin-writing` — this skill is only how it gets there.

## The one thing people get wrong

**"Why hasn't it posted?" is almost never a bug.** Publishing is gated on a
GitHub Actions Environment with a required reviewer. The workflow runs, renders,
pings Telegram, then _pauses_ until a human clicks approve in the Actions UI.
That gate is deliberate — check for a waiting job before debugging anything.

## What exists

| Lane                | Workflow                                     | Trigger                      | For                           |
| ------------------- | -------------------------------------------- | ---------------------------- | ----------------------------- |
| Monthly Clone Watch | `.github/workflows/clone-watch-linkedin.yml` | cron 2nd of month + dispatch | The recurring 7-slide edition |
| One-off decks       | `.github/workflows/hub-linkedin.yml`         | dispatch only                | Launch decks, announcements   |

Both are two-stage — `prepare` (render + Telegram the slides for review) →
`publish` (gated) — and both post as the company via `lib/linkedin/client.ts`.

| Piece                                                                                       | Path                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| API client (the only place that knows LinkedIn)                                             | `apps/web/lib/linkedin/client.ts`             |
| Monthly publisher (month-keyed, dedupes on `clone_watch_report_summary.published_post_urn`) | `apps/web/scripts/clone-watch-publish.ts`     |
| Generic publisher (no month, no DB write-back)                                              | `apps/web/scripts/linkedin-document-post.ts`  |
| Carousel renderers                                                                          | `hub:carousel`, `report-card:export`          |
| Hub caption                                                                                 | `docs/linkedin/hub-launch-caption.txt`        |
| Design + runbook                                                                            | `docs/ops/clone-watch-linkedin-automation.md` |

## Posting an existing one-off deck

1. Edit `docs/linkedin/hub-launch-caption.txt`. **Re-verify every number against
   the database** — captions cite live figures and they drift. Rolling-window
   numbers move daily; calendar-month cohort numbers are fixed once the month
   closes, so prefer a cohort figure in copy that will be read later.
2. Actions → the workflow → **Run workflow**. Tick `dry_run` to exercise the
   whole path (including the upload) without publishing.
3. Telegram delivers the slides, the exact PDF, and the caption.
4. **Approve the `publish` job.** Only a required reviewer can.
5. Open the post URL and confirm it renders — see the visibility trap below.

## Adding a NEW lane

Clone `hub-linkedin.yml` and change the render step and caption path. Two
non-obvious rules:

- **Reuse `environment: clone-watch-linkedin`.** The required-reviewer rule lives
  ON the environment. A fresh environment has NO reviewer, so a new lane
  declaring its own would publish to the company page unapproved until someone
  remembered to configure it — a silent, public failure.
- **No cron unless it genuinely recurs.** Dispatch-only for anything one-off.

Reuse `linkedin-document-post.ts` rather than cloning `clone-watch-publish.ts`;
the latter is bound to a month key and a summary row that a one-off doesn't have.

## Hard constraints (LinkedIn Dev-Tier — not bugs, do not "fix")

- **Company page only.** The author is always `LINKEDIN_ORG_URN`, and
  `linkedin-document-post.ts` refuses to run unless it is a
  `urn:li:organization:`. Personal-profile resharing is always manual.
- **No draft state.** `createDocumentPost` publishes `PUBLIC` / `MAIN_FEED`
  immediately. There is no "post it quietly and review it" — the Telegram
  preview before the gate _is_ the review.
- **Comments 403.** The first comment is surfaced for you to paste by hand.
- **Captions cap at 3000 chars.** Past that LinkedIn truncates, silently taking
  the closing line and the link with it. The publisher fails loudly instead.

## The visibility trap

**A green publish is NOT proof anyone can see the post.** On 2026-08-07 an
edition returned HTTP 201, read back as `PUBLISHED` / `PUBLIC` / `MAIN_FEED`
with an `AVAILABLE` document, appeared in the org's own post listing — and still
rendered "Post cannot be displayed", never appearing in Page posts. LinkedIn
exposes no member-visibility signal at this tier (`socialActions` is 403), so no
automated check can close the gap.

`VERIFY=ok` means every API-observable field checked out. Treat it as necessary,
never sufficient: **open the URL and look.**

## Voice

Posts from the company page use "we", not "I" — match the monthly editions
("In July 2026, we detected…"). A founder-voice draft written for a personal
profile needs its first-person singulars converted before it goes out as the
company.

## Troubleshooting

- **Nothing posted** → check for a `publish` job awaiting approval. Not a bug.
- **Token refresh fails** → the refresh token expired; re-mint and update the
  `LINKEDIN_REFRESH_TOKEN` secret. The publisher prefers the refresh grant and
  only falls back to `LINKEDIN_ACCESS_TOKEN`.
- **Comment 403** → expected. Paste by hand.
- **Post shows "cannot be displayed"** → the visibility trap above. Delete and
  re-post; there is no API signal to diagnose it.
