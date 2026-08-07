# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Wayfinder maps (the `/wayfinder` skill) live on this tracker as GitHub issues:

- **The map** is a single issue labelled `wayfinder:map`; its body is the canonical low-res view (Destination / Notes / Decisions so far / Not yet specified / Out of scope).
- **Tickets** are ordinary issues that reference the map with a `Child of map #<n>` line in the body, and carry one `wayfinder:<type>` label (`research`, `prototype`, `grilling`, `task`).
- **Blocking** uses a `Blocked by: #a, #b` body line (the `gh` CLI lacks native dependency support). A ticket is unblocked when every listed blocker is closed.
- **The frontier** = open, unassigned children whose blockers are all closed. **Claiming** = assigning yourself before any work; an open unassigned ticket is unclaimed.
- **Resolution** = a resolution comment with the answer, close the issue, append a one-line gist to the map's _Decisions so far_.

Precedent: map [#898](https://github.com/matchmoments-admin/ask-arthur/issues/898) (the 2026-08 realignment) — 9 tickets, fully worked; read it for the shape.
