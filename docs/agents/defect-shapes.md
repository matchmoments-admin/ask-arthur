# Defect shapes — what this codebase has already paid for

An index of defect **classes** with recorded recurrence here, and whether each is
enforced by a test or only described in a comment.

## Why this file exists

`apps/web/__tests__/rowCap.test.ts:20` states the finding this index is built on:

> "THIS RULE ALREADY EXISTED IN PROSE AND STILL REGRESSED. … A correct comment is
> not a control. This test is the control."

The evidence across the repo agrees. About 90 comment blocks record a past
defect, and they collapse into 13 shapes. The shapes that acquired a test stopped
recurring; the shapes that stayed comments did not:

| Shape                                               | Recorded as                       | What happened next                          |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| PostgREST 1,000-row cap                             | a test (`rowCap.test.ts`)         | caught a later `.limit(2000)` automatically |
| A caption claiming a window the query never applies | two comments naming it as a class | recurred on **two more live surfaces**      |
| Cohort-scoped worklist                              | prose in `CLAUDE.md`              | recurred at **four** pipeline stages        |

A comment sits at the crime scene. It relies on the next author opening that
file, and it never fires. The comment at `apps/web/lib/dashboard.ts:144` says so
in as many words: _"This is a class the repo has fixed twice already."_

## How to use it

- **Before a review** — read the shape names. They turn "is anything wrong here?"
  into a finite set of questions, which is the difference between a checklist
  that works and one that gets skipped.
- **When you find a defect** — check whether it is an instance of a listed shape.
  If it is, and the shape is guarded, the guard has a hole: say which. If it is
  new, add a row.
- **When you fix a defect** — the `software-architecture` skill already requires
  the fitness function in the same PR. This index is where the result is
  recorded so the next person can find it.

Only shapes with **recorded recurrence in this repo** belong here. A generic
code-smell list is ignorable, and rightly.

---

## The index

Ranked by how many times each has bitten.

### Unguarded, ranked — this is the backlog

| #   | Shape                                                                                                                                                                              | Sites | Guard                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| A   | **A caption asserts a time window the query never applies**, or applies to the wrong column                                                                                        | 7     | **PARTIAL** — `dashboardScamTypeWindow.test.ts` covers one function behaviourally. Nothing scans for the class.   |
| F   | **A branch or state exists on one side of a seam with no reachable writer or reader on the other**                                                                                 | 7     | **NONE** as a class                                                                                               |
| E   | **A re-submit path fails to move the row back across the exact predicate its consumer filters on**, so the loop is silently inert                                                  | 7     | **PARTIAL** — `redditIntelEmbedWorklist.test.ts` guards one pipeline                                              |
| G   | **One figure computed by N independent reads of a mutating table**, so published artefacts disagree                                                                                | 5     | **PARTIAL** — two specific pairs locked                                                                           |
| N   | **A guard asserts a proxy for the behaviour instead of the behaviour** — a source token, a rendered blob, a path where the defect is inert, or a corpus the guard itself truncated | 4     | **PARTIAL** — the cron case is now behavioural (`redditIntelEmbedWorklist.test.ts`). Nothing scans for the class. |
| H   | **A dedup key dedups a retry against a _failed_ original**                                                                                                                         | 4     | **NONE**                                                                                                          |
| I   | **A cron with a manual trigger and no throttle + cooldown** lets stacked fires breach caps                                                                                         | 3     | **NONE** — mechanically checkable off the constructed `inngestFunctions` array                                    |
| B   | **An off-by-one window boundary makes an N+1-day "week"** (`gte` where `gt` was meant)                                                                                             | 2     | **PARTIAL** — cost digest only                                                                                    |
| J   | **A test/dry-run early return short-circuits the very lane it claims to validate**                                                                                                 | 2     | **NONE**                                                                                                          |
| K   | **Cron _ordering_ is load-bearing** — move one and the downstream gate starves rather than filters                                                                                 | 2     | **NONE**                                                                                                          |

### Guarded — no action, listed so a recurrence is recognised as a hole

| #   | Shape                                                                                            | Guard                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| C   | PostgREST's 1,000-row cap silently truncates, and a guard written _above_ the cap can never fire | `rowCap.test.ts`                                                         |
| D   | A failed read coalesced with `?? 0` / `?? []` renders identically to a healthy zero              | `adminErrorBand.test.ts`, `queryErrorBand.test.tsx`, `readCount.test.ts` |
| L   | An auth or network call without a timeout hangs the whole surface                                | `middlewareTimeout.test.ts`, `authHardening.test.ts`                     |
| M   | A cost cap fails open, or is disabled by a missing env or a higher gate                          | `costDailyCheckHiveBrake.test.ts`, `featureBrakes.test.ts`               |
| —   | A feature gate evaluated at build time bakes in one answer                                       | `featureGateRuntime.test.ts`                                             |
| —   | An input a caller passes and the callee discards                                                 | `ignoredInputs.test.ts`                                                  |
| —   | Doc/fleet drift in the Inngest brake matrix                                                      | `inngestBrakesMatrixDrift.test.ts`                                       |
| —   | A per-field cap on model output discarding a whole batch                                         | `take-writer-schema-shape.test.ts`                                       |
| —   | Two vocabularies for one concept, diverging silently                                             | `scamTaxonomy.test.ts`                                                   |

---

## The three worth writing next, and why

**A — the caption class.** Seven sites, and the comment at `lib/dashboard.ts:144`
records that it recurred _after two prior fixes_. The tractable half is now
guarded (`ignoredInputs.test.ts` catches a window parameter accepted and
ignored). The untractable half is real and should be stated rather than papered
over: `SafeEntityTable.tsx:46` captions "Top detected this week" over a query with no
date filter at all, and nothing static can correlate the words with the SQL. A
guard could plausibly flag a `Last N days` / `7d` / `30d` string in a component
whose loader has no `.gte`, but crossing that file boundary reliably is the hard
part.

**I — cron plus manual trigger without a throttle.** The cheapest of the three,
because `inngestBrakesMatrixDrift.test.ts` already reads `fn.id()` off the
**constructed** `inngestFunctions` array. The same array exposes triggers and
throttle config, so the guard is an extension of an existing, working pattern
rather than a new sweep.

**F — a branch with no reachable writer.** The most valuable and the hardest.
`reddit-brands-discover.ts:356` explains precisely why the obvious test does not
work: _"a producer and a consumer disagreeing about an enum is invisible to a
fixture that plays both parts."_ Any guard here has to compare the producer's
emitted set against the consumer's handled set from **source**, not from a
fixture.

---

## N — the shape that produced four of this week's misses

Four times in one week a test passed while the thing it named was broken. Each
time the assertion's **subject** was a stand-in for the behaviour.

It sits mid-table by count, but it is the one shape that acts on the others:
every row in this file is guarded by a test, and this is the failure mode of
tests. A proxy assertion does not merely miss its own defect — it converts an
entry in the guarded table into a false one.

| Site                                       | The assertion                                        | What it let through                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redditIntelEmbedWorklist.test.ts` (#1107) | `expect(src.includes("event?.data")).toBe(true)`     | The string was present; the code was fatal on every cron tick. Both drain stages failed 4x per tick until a Telegram page found it.                            |
| Badge eligibility (#1109)                  | Exercised the route with grade `F`                   | `F` is below `ELIGIBLE_GRADES`, so the route bailed before the forgery it was testing could matter. The test passed with the bug reinstated.                   |
| Showcase copy (#1044)                      | `expect(html).not.toContain("100")`                  | Matched `stop-offset="100%"` in an SVG gradient, not the figure under test. Fixed with a `visibleText()` extractor.                                            |
| `ignoredInputs.test.ts`                    | Stripped template literals file-wide before matching | One unbalanced backtick swallowed 2,288 characters _including the declaration the guard existed to find_. It reported clean because it had eaten the evidence. |

**The tell.** Ask what the assertion would still do if the implementation were
replaced by something that merely _mentions_ the right words. A guard reading
`readFileSync` and matching a token cannot distinguish working code from a
comment. A guard exercising a path where the defect is inert proves the path,
not the defect.

**The remedy, in order of preference.** Call the function with the input that
breaks it. Where the fix is a decision, extract it as a pure function so the
test has something to _call_ rather than grep — that is what #1113 did, moving
the cron/event discrimination into `resolveRedditIntel*Data` in `events.ts`.
Where a source-level sweep is genuinely the only option (drift, duplication,
class-wide bans), keep it — but assert **absence of duplication**, never
presence of an idiom, and pair it with a behavioural test of the single place
the logic now lives.

**Go-red is the acceptance criterion, not a nicety.** Every guard in this file
that has caught something was verified by reinstating the bug and watching it
fail. Three of the four rows above would have been caught at write time by that
one step. #1113's replacement was verified this way: reinstating the truthiness
branch fails it with the same `ZodError` prod was throwing.

**Where a source sweep is still the honest tool**, say what it does _not_ catch
in the file itself — `ignoredInputs.test.ts` does this well, and it is the
convention.

---

## House style for a new guard

`apps/web/__tests__/rowCap.test.ts` is the archetype. Match it:

1. **A header naming the incident, with measured numbers**, and why prose was not
   enough. End with the remedy, so the failure message can be terse.
2. **Strip comments before matching, preserving line numbers** — otherwise the
   guard fires on the prose that explains the rule.
3. **Assert the sweep is not inert.** `expect(files.length).toBeGreaterThan(200)`.
   A guard that stops scanning reports success, which is worse than no guard.
4. **Offenders as an array, `.toEqual([])`** — never a count, so the failure
   prints what to fix.
5. **`ALLOWLIST: Record<file, reason>`, and assert the allowlist too** — that
   each file still exists and each reason is real. A stale entry permits
   silently.
6. **Prefer the constructed object to a regex** where one exists
   (`inngestBrakesMatrixDrift.test.ts:26`).
7. **Where static analysis is known to undercount, demand a declaration** rather
   than guessing — `inngestFinishBudgets.test.ts:25` makes an undeclared file
   fail, on the grounds that _"a guard that reads as protection while protecting
   nothing is worse than no guard."_
8. **Record the go-red.** Say in the file which change makes it fail. A test that
   has only ever been green is a claim, not evidence.

---

## Where this is referenced

- `.claude/skills/software-architecture/SKILL.md` — fitness-function list.
- `docs/agents/weekly-arch-review.md` — pre-flight, so the weekly routine starts
  from known classes instead of rediscovering them.
