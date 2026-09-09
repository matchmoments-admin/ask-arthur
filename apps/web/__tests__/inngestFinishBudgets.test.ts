import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #1069 — finish-timeout budgets must survive account-concurrency queueing.
 *
 * The Inngest Hobby plan gives the whole account 5 concurrent execution slots
 * (ADR-0019). Every `step.run` boundary re-queues for a slot, and when the
 * fleet's long inline-batch steps hold slots (post-v284/v285 they grew to
 * 40–200s each), a queued step measured ~30–60s of wait PER BOUNDARY
 * (2026-09-02, #1061). A `timeouts.finish` tuned for fast dispatch then
 * CANCELS healthy runs — and a cancellation gets no retries, no error, and no
 * telemetry. Measured damage before this guard existed: 44 of 51 preclassify
 * runs cancelled at exactly start+2m, 58% of the lane's cost telemetry lost,
 * urlscan-retrieve cancelled at exactly its 5m budget two days running, and
 * eighteen weaponised brand alerts silently dropped across two episodes.
 *
 * FLOOR = boundaries × 30s + inline wall-clock guards + 60s slack.
 *
 * **Counting boundaries is the whole difficulty, and this guard refuses to
 * guess it.** The first version of this test counted static `step.run(` call
 * sites, which undercounts every function whose step sites sit inside a
 * per-item loop: `clone-watch-auto-triage` has 3 sites in a 15-item loop = 45
 * runtime boundaries, and the test passed it at 3. A guard that reads as
 * protection while protecting nothing is worse than no guard, so when a file
 * shows either signal that static counting is wrong —
 *
 *   1. an INTERPOLATED step id (`step.run(\`fetch-${id}\`)`) — the marker of a
 *      per-item step inside a loop, whose count is a runtime cap the regex
 *      cannot read; or
 *   2. ZERO static step sites alongside a finish timeout — the steps live in a
 *      helper (e.g. onward-apwg → runUrlBlocklistOnward), invisible here;
 *
 * — the file must DECLARE its worst-case boundary count in a comment:
 *
 *   // inngest-finish-budget: <N> boundaries — <how N was derived>
 *
 * and the declared N is used. An undeclared file of either shape FAILS, with
 * the message telling the author to declare rather than silently passing on a
 * number nobody checked.
 *
 * Reducing N beats raising the budget: fold per-item steps into one batch step
 * (urlscan-retrieve/-submit are the reference shape) or add a wall-clock guard
 * that breaks the loop early and lets the tail drain next tick.
 *
 * Verified go-red: against the pre-#1069 budgets this fails for preclassify
 * (2m/4 steps), urlscan-retrieve (5m/4 steps + 200s batch), urlscan-submit
 * (5m/5 steps + 200s batch), notify-weaponised (3m/15 steps) and
 * report-summary (2m/4 steps); and against undeclared loop functions it fails
 * with the declaration message.
 */

const SCAN_DIRS = [
  new URL("../app/api/inngest/functions/", import.meta.url),
  // 19 registered functions with finish timeouts live here and contend for the
  // same 5 account slots — omitting them left the rule half-enforced.
  new URL("../../../packages/scam-engine/src/inngest/", import.meta.url),
];

const QUEUE_WAIT_SECONDS_PER_STEP = 30;
const SLACK_SECONDS = 60;

const STEP_SITE_RE = /\bstep\.run(?:<[^>]*>)?\(/g;
// `step.run(`name-${x}`)` — a template-literal id is how a per-item step in a
// loop gets a unique name, so it is the reliable marker for "count is a
// runtime cap, not a source count".
const INTERPOLATED_STEP_RE = /\bstep\.run(?:<[^>]*>)?\(\s*`[^`]*\$\{/;
const DECLARED_BOUNDARIES_RE = /inngest-finish-budget:\s*(\d+)\s*boundaries/;

function declaredFinishSeconds(src: string): number | null {
  const m = /timeouts:\s*\{[^}]*finish:\s*"(\d+)(m|s)"/.exec(src);
  if (!m) return null; // no finish timeout → cannot be cancelled by one
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

function wallClockSeconds(src: string): number {
  return (
    [...src.matchAll(/_WALL_CLOCK_MS\s*=\s*([\d_]+)/g)]
      .map((m) => Number(m[1].replaceAll("_", "")))
      .reduce((a, b) => a + b, 0) / 1000
  );
}

interface RegisteredFn {
  file: string;
  ordinal: number;
  of: number;
  label: string;
  /** Source from the function's leading comment block to the next function. */
  body: string;
}

/**
 * Every registered function, sliced PER FUNCTION rather than per file.
 *
 * WHY THE SLICING MATTERS. Both guards in this file used to read one file at a
 * time, which is wrong in two directions once a file defines more than one
 * function: the coverage check saw the FIRST finish timeout and called the file
 * covered (phone-footprint-refresh-monitor and enrich-vulnerability-au-context
 * were unbounded behind a covered sibling), and the floor check compared one
 * function's finish against the whole file's step sites and boundary
 * declaration. Second time in this workstream a sweep turned out to be half a
 * sweep (#1139).
 *
 * A function's region starts at its leading comment block — that is where the
 * `inngest-finish-budget:` declaration lives — and runs to the next function's
 * region. So the declaration, the `timeouts`, and the `step.run` sites all
 * attribute to the same function.
 */
function registeredFunctions(): RegisteredFn[] {
  const out: RegisteredFn[] = [];
  for (const dir of SCAN_DIRS) {
    for (const f of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const src = readFileSync(new URL(f, dir), "utf8");
      const lines = src.split("\n");
      // Line index of each `inngest.createFunction(`.
      const hits = lines
        .map((l, i) => (/inngest\.createFunction\(/.test(l) ? i : -1))
        .filter((i) => i >= 0);
      if (hits.length === 0) continue;

      // Walk back over the declaration statement and its leading comments.
      const starts = hits.map((hit) => {
        let i = hit;
        while (i > 0 && !/^\s*(?:export\s+)?const\s/.test(lines[i]!)) i--;
        while (i > 0) {
          const prev = lines[i - 1]!.trim();
          if (
            prev.startsWith("//") ||
            prev.startsWith("*") ||
            prev.startsWith("/*")
          )
            i--;
          else break;
        }
        return i;
      });

      hits.forEach((_, idx) => {
        // A file with ONE function IS that function: use the whole file, so
        // step.run sites in helpers defined above it still count. Slicing
        // there would have demanded a boundary declaration from
        // shop-signal-enrich for steps the per-file version counted correctly.
        const from = hits.length === 1 ? 0 : starts[idx]!;
        const to =
          hits.length === 1
            ? lines.length
            : idx + 1 < starts.length
              ? starts[idx + 1]!
              : lines.length;
        out.push({
          file: f,
          ordinal: idx + 1,
          of: hits.length,
          label:
            hits.length === 1
              ? f
              : `${f} (function ${idx + 1} of ${hits.length})`,
          body: lines.slice(from, to).join("\n"),
        });
      });
    }
  }
  return out;
}

/**
 * Coverage, not just correctness: a function with NO finish timeout is invisible
 * to the floor check above, because `declaredFinishSeconds` returns null and the
 * test returns early. That is how seven scam-engine functions sat unbounded for
 * months while this file reported 77 green tests — the guard was real and the
 * gap was simply out of its reach.
 *
 * ADR-0019 prescribes `timeouts.finish` fleet-wide as the circuit breaker:
 * finite, so a hung step cannot hold one of the account's five slots or rack up
 * step-runs across the whole retry ladder.
 *
 * The ALLOWLIST is asserted in both directions. An unlisted file without a
 * finish timeout fails (the door is closed to new ones); a listed file that has
 * SINCE GAINED one also fails, so the list cannot rot into permission.
 */
const NO_FINISH_ALLOWLIST: Record<string, string> = {
  // EMPTY as of #1139. Every registered Inngest function in both directories
  // now declares a finish timeout. Keep the mechanism: an entry here is how a
  // deliberate exception is recorded, and the staleness check below is what
  // stops one becoming permanent.
};

describe("every registered Inngest function declares a finish timeout", () => {
  const defined = registeredFunctions();

  it("finds the registered functions (guards a silently-empty sweep)", () => {
    expect(defined.length).toBeGreaterThan(60);
    // At least one file defines more than one — if that stops being true the
    // per-function split is untested against the case it exists for.
    expect(defined.some((f) => f.of > 1)).toBe(true);
  });

  it("has no unlisted function without one", () => {
    const offenders = defined
      .filter((f) => declaredFinishSeconds(f.body) == null)
      .map((f) => f.label)
      .filter((n) => !(n in NO_FINISH_ALLOWLIST));
    expect(
      offenders,
      "These functions declare no timeouts.finish, so nothing bounds a hung " +
        "run:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\nDerive one (boundaries x 30s + inline wall-clocks + 60s slack) " +
        "or add it to NO_FINISH_ALLOWLIST with a reason.",
    ).toEqual([]);
  });

  it("has no stale allowlist entry", () => {
    // A function that gained a finish timeout must leave the list, or the
    // list starts granting permission nobody asked for.
    const stale: string[] = [];
    for (const key of Object.keys(NO_FINISH_ALLOWLIST)) {
      const fn = defined.find((f) => f.label === key);
      if (!fn) stale.push(`${key} (no longer a registered function — remove)`);
      else if (declaredFinishSeconds(fn.body) != null) {
        stale.push(`${key} (now HAS a finish timeout — remove)`);
      }
    }
    expect(stale).toEqual([]);
  });
});

/**
 * Containment for the fleet's only unbounded fan-in.
 *
 * `analyze-failure-subscriber` triggers on `inngest/function.failed`, i.e. on
 * EVERY function's final-retry failure fleet-wide. Until #1135 it declared no
 * concurrency, throttle, rateLimit or idempotency, so during an incident its
 * invocations scaled 1:1 with failures across ~46 functions — at exactly the
 * moment the account can least afford them.
 *
 * This asserts DECLARATIVE CONFIG by reading the source, the same way the floor
 * check above reads `timeouts.finish`. It cannot prove Inngest honours the key;
 * it proves the config still says what the incident analysis concluded.
 */
describe("analyze-failure-subscriber stays contained", () => {
  // Comments stripped before matching: the file's own docblock explains WHY
  // rateLimit rather than throttle, and the first version of this guard fired
  // on that prose. "Strip comments before matching" is rule 2 of the house
  // style in docs/agents/defect-shapes.md, learned here exactly that way.
  const src = readFileSync(new URL("analyze-failure.ts", SCAN_DIRS[1]!), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/[^\n]*/g, " "))
    .join("\n");

  it("caps invocations per failing function, discarding rather than queueing", () => {
    // rateLimit DISCARDS, throttle QUEUES (memory/MEMORY.md). In a failure
    // storm a queue holds the backlog — and the slots — long after the storm.
    expect(src).toMatch(/rateLimit:\s*\{[^}]*limit:\s*\d+/);
    // Keyed per failing function, so one loud failure cannot mask another.
    expect(src).toMatch(
      /rateLimit:\s*\{[^}]*key:\s*"event\.data\.function_id"/,
    );
    expect(src).not.toMatch(/throttle:/);
  });

  it("compares the app-prefix-stripped id, not the raw one", () => {
    // function.failed carries the ABSOLUTE id ("askarthur-analyze-report"), so
    // both the family filter and the self-exclusion have to strip the prefix
    // first — without it they match nothing at all and the subscriber logs
    // nothing (#1138). The behaviour itself is covered by calling
    // bareFunctionId in packages/scam-engine/.../analyze-failure.test.ts; this
    // only pins that the filters go through it.
    expect(src).toMatch(/bareId === SELF_FUNCTION_ID/);
    expect(src).toMatch(/bareId\.startsWith\(ANALYZE_FUNCTION_ID_PREFIX\)/);
  });
});

describe("Inngest finish budgets tolerate concurrency-queue waits", () => {
  const fns = registeredFunctions();
  expect(fns.length).toBeGreaterThan(10);

  for (const file of fns) {
    it(`${file.label} finish budget covers its boundary count`, () => {
      const src = file.body;
      const finish = declaredFinishSeconds(src);
      if (finish == null) return; // no finish timeout — nothing to breach

      const staticSites = (src.match(STEP_SITE_RE) ?? []).length;
      const declared = DECLARED_BOUNDARIES_RE.exec(src);
      const needsDeclaration =
        INTERPOLATED_STEP_RE.test(src) || staticSites === 0;

      if (needsDeclaration && !declared) {
        throw new Error(
          `${file.label}: has ${staticSites === 0 ? "no static step sites (steps live in a helper)" : "per-item step ids inside a loop"}, ` +
            `so counting \`step.run(\` call sites would UNDERCOUNT the runtime boundaries and pass a budget nobody checked. ` +
            `Declare the worst case in a comment: "inngest-finish-budget: <N> boundaries — <derivation>". ` +
            `Prefer reducing N (fold per-item steps into one batch step, or add a wall-clock guard) over raising the budget.`,
        );
      }

      // A DECLARATION MAY RAISE THE COUNT, AND MAY ONLY LOWER IT WITH A
      // SPANNING BUDGET. `declared ?? staticSites` let any file cut its own
      // floor to nothing by writing "inngest-finish-budget: 1 boundaries" —
      // the guard-that-reads-as-protection shape this file's own docblock
      // warns about (caught in review, #1138).
      //
      // Under-declaring IS legitimate in exactly one case: a spanning budget
      // caps the run's wall clock, so the structural boundary count cannot
      // co-occur with it (scam-reports-backfill-embed declares 22 against a
      // structural 102 because 600s admits ~20 boundaries at the 30s queue
      // wait — declaring 102 would demand a 62-minute "circuit breaker" for a
      // run the budget bounds at ~11 minutes). That case is recognised by the
      // file actually constructing one.
      const declaredCount = declared ? Number(declared[1]) : null;
      const hasSpanningBudget = /\bspanningBudget\(/.test(src);
      if (
        declaredCount !== null &&
        declaredCount < staticSites &&
        !hasSpanningBudget
      ) {
        throw new Error(
          `${file.label}: declares ${declaredCount} boundaries but has ${staticSites} static step.run sites, ` +
            `which LOWERS its own floor. Under-declaring is only sound when a spanningBudget() caps the run's ` +
            `wall clock, and this file constructs none. Raise the declaration, or bound the run.`,
        );
      }
      const boundaries =
        declaredCount === null
          ? staticSites
          : hasSpanningBudget
            ? declaredCount
            : Math.max(declaredCount, staticSites);
      const required =
        boundaries * QUEUE_WAIT_SECONDS_PER_STEP +
        wallClockSeconds(src) +
        SLACK_SECONDS;

      expect(
        finish,
        `${file.label}: finish budget ${finish}s < floor ${required}s ` +
          `(${boundaries} boundaries${declared ? " (declared)" : ""} × ${QUEUE_WAIT_SECONDS_PER_STEP}s queue wait ` +
          `+ ${wallClockSeconds(src)}s inline wall-clocks + ${SLACK_SECONDS}s slack). ` +
          `A too-small finish budget CANCELS healthy runs silently — see #1069.`,
      ).toBeGreaterThanOrEqual(required);
    });
  }
});
