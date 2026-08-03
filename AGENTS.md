# Ask Arthur — agent instructions

**Read [`CLAUDE.md`](./CLAUDE.md). It is the single source of truth for this repo, for every agent and every human.**

Do that before making any change. Everything that used to be duplicated here — the quick-reference map, the critical rules, the ship workflow, the environment inventory — lives there and only there.

## Why this file is a pointer and not a copy

Until 2026-07-29 this file was a full 330-line copy of `CLAUDE.md`, maintained by hand alongside it. It had drifted: the Quick Reference table was stale, it was 15 lines behind, and its skill paths had been rewritten to a `.Codex/` directory that does not exist. It was also untracked, so the drift was invisible to review.

An enterprise review of this codebase found that its single most common defect class is **documentation asserting something that is not true** — a comment claiming an auth check that was never written, a security doc describing a control that had regressed, a brakes matrix missing half the functions it exists to audit. Two hand-maintained copies of the same guide is that same failure waiting to happen, and the copy is always the one that goes stale.

So: one master, referenced from everywhere. If you find yourself wanting to add project instructions here, add them to `CLAUDE.md` instead.

## Directory-scoped guides

`CLAUDE.md` is the root. Some directories add scoped guidance on top of it — read the local one first when working inside:

- `apps/web/CLAUDE.md`
- `packages/bot-core/CLAUDE.md`
- `packages/scam-engine/CLAUDE.md`
- `packages/supabase/CLAUDE.md`
- `packages/types/CLAUDE.md`
- `pipeline/scrapers/CLAUDE.md`
- `supabase/CLAUDE.md`

This list must match `git ls-files '*CLAUDE.md'` (minus the root) — it drifted once already;
`/drift-check` verifies it.
