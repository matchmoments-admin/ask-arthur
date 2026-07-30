import { describe, it, expect } from "vitest";
import {
  classifyFeedHealth,
  livenessThresholdHours,
  type FeedHealthRow,
} from "@/lib/feedHealth";

/**
 * Every case here is a real prod state measured 2026-07-30. The point of the
 * rewrite was that the previous single "stale" check reported ALL of these as
 * healthy, so the tests assert against the observed rows rather than invented
 * ones.
 */

function row(over: Partial<FeedHealthRow> & { feed_name: string }): FeedHealthRow {
  return {
    poll_schedule: "daily 16:00 UTC",
    expect_new_rows_days: null,
    is_muted: false,
    muted_reason: null,
    last_run_at: "2026-07-30T02:00:00Z",
    last_success_at: "2026-07-30T02:00:00Z",
    last_useful_at: "2026-07-30T02:00:00Z",
    runs_7d: 7,
    new_rows_7d: 10,
    hours_since_success: 1,
    days_since_useful: 0.1,
    ...over,
  };
}

describe("livenessThresholdHours", () => {
  it.each([
    ["every 3h", 15],
    ["every 6h", 18],
    ["every 12h", 24],
    ["daily 16:00 UTC", 48],
    ["weekly Sun 04:00", 336],
  ])("%s → %ih", (schedule, expected) => {
    expect(livenessThresholdHours(schedule)).toBe(expected);
  });

  it("treats an unknown or null schedule as daily rather than infinite", () => {
    // The old hand-maintained map had `acsc: 999`, which permanently hid a dead
    // feed. An unknown cadence must never produce an unreachable threshold.
    expect(livenessThresholdHours(null)).toBe(48);
    expect(livenessThresholdHours("event-driven")).toBe(48);
    expect(livenessThresholdHours("")).toBe(48);
  });

  it("is generous enough to absorb GitHub's cron dispatch delay", () => {
    // Median delay ~114 min, p90 175 min. A 3-hourly feed must not alarm on it.
    expect(livenessThresholdHours("every 3h")).toBeGreaterThan(3 + 175 / 60);
  });
});

describe("classifyFeedHealth — the four verdicts", () => {
  it("flags a feed that has logged NOTHING as absent", () => {
    // acnc_register / pfra_members: 0 runs. This is the shape that used to be
    // completely invisible, because it drops out of any query grouping by what
    // is present.
    const { problems } = classifyFeedHealth([
      row({ feed_name: "acnc_register", last_run_at: null, last_success_at: null, runs_7d: 0 }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe("absent");
  });

  it("flags a feed that runs but has never succeeded", () => {
    // acsc: 430 runs in 30d, zero successes ever. Previously read as fresh
    // because the latched backoff wrote a partial every ~1.8h.
    const { problems } = classifyFeedHealth([
      row({
        feed_name: "acsc",
        last_run_at: "2026-07-30T02:44:00Z",
        last_success_at: null,
        hours_since_success: null,
        runs_7d: 103,
      }),
    ]);
    expect(problems[0].kind).toBe("never_succeeds");
    expect(problems[0].detail).toContain("zero successes ever");
  });

  it("flags a feed whose last success is older than its cadence allows", () => {
    // pfra_members: last success 1,972h (82 days) ago.
    const { problems } = classifyFeedHealth([
      row({ feed_name: "pfra_members", hours_since_success: 1972.9, runs_7d: 0 }),
    ]);
    expect(problems[0].kind).toBe("stale");
    expect(problems[0].detail).toContain("1972.9h");
  });

  it("flags a feed that succeeds forever while ingesting nothing", () => {
    // phishing_database: 244 runs, all success, records_fetched=0 on every one,
    // because the upstream returns HTTP 200 with a 1-byte body.
    const { problems } = classifyFeedHealth([
      row({
        feed_name: "phishing_database",
        expect_new_rows_days: 3,
        last_useful_at: null,
        days_since_useful: null,
        new_rows_7d: 0,
      }),
    ]);
    expect(problems[0].kind).toBe("silent_success");
    expect(problems[0].detail).toContain("never");
  });

  it("does NOT flag zero new rows when the feed opted out of the productivity check", () => {
    // feodo (static 5-entry upstream, 82d with no new rows) and crtsh (retained
    // purely as a staleness keep-alive) are CORRECT at 0 new rows.
    const { problems } = classifyFeedHealth([
      row({ feed_name: "feodo", expect_new_rows_days: null, days_since_useful: 82.2, new_rows_7d: 0 }),
      row({ feed_name: "crtsh", expect_new_rows_days: null, days_since_useful: 54.4, new_rows_7d: 0 }),
    ]);
    expect(problems).toEqual([]);
  });

  it("does NOT flag a legitimately quiet feed inside its own window", () => {
    // scamwatch_alert genuinely publishes ~1 new item a month.
    const { problems } = classifyFeedHealth([
      row({ feed_name: "scamwatch_alert", poll_schedule: "every 3h", expect_new_rows_days: 30, days_since_useful: 15.9, hours_since_success: 0.5 }),
    ]);
    expect(problems).toEqual([]);
  });
});

describe("classifyFeedHealth — muting", () => {
  it("excludes muted feeds from problems but still counts them", () => {
    // The hardcoded Set this replaced was invisible, which is how it drifted to
    // muting 7 actively-producing feeds. A mute must always be reported.
    const { problems, mutedCount, checked } = classifyFeedHealth([
      row({ feed_name: "acsc", is_muted: true, last_success_at: null, hours_since_success: null }),
      row({ feed_name: "urlhaus" }),
    ]);
    expect(problems).toEqual([]);
    expect(mutedCount).toBe(1);
    expect(checked).toBe(2);
  });

  it("a healthy fleet produces no problems", () => {
    const { problems } = classifyFeedHealth([
      row({ feed_name: "urlhaus", poll_schedule: "every 6h", expect_new_rows_days: 3 }),
      row({ feed_name: "phishtank", poll_schedule: "every 6h", expect_new_rows_days: 3 }),
    ]);
    expect(problems).toEqual([]);
  });
});

describe("classifyFeedHealth — ordering", () => {
  it("ranks absent and never-succeeded above stale and silent-success", () => {
    const { problems } = classifyFeedHealth([
      row({ feed_name: "d_silent", expect_new_rows_days: 1, days_since_useful: 40 }),
      row({ feed_name: "c_stale", hours_since_success: 5000 }),
      row({ feed_name: "b_never", last_success_at: null, hours_since_success: null }),
      row({ feed_name: "a_absent", last_run_at: null, last_success_at: null }),
    ]);
    expect(problems.map((p) => p.kind)).toEqual([
      "absent",
      "never_succeeds",
      "stale",
      "silent_success",
    ]);
  });
});

describe("regression: the exact prod fleet on 2026-07-30", () => {
  it("reports the five real problems the old digest called 'all clear'", () => {
    const fleet: FeedHealthRow[] = [
      row({ feed_name: "acnc_register", last_run_at: null, last_success_at: null, hours_since_success: null, runs_7d: 0, expect_new_rows_days: 30 }),
      row({ feed_name: "acsc", is_muted: true, last_success_at: null, hours_since_success: null, runs_7d: 103 }),
      row({ feed_name: "github_advisory", poll_schedule: "weekly Sun 04:00", last_success_at: null, hours_since_success: null, runs_7d: 1 }),
      row({ feed_name: "nvd_recent", poll_schedule: "weekly Sun 04:00", last_success_at: null, hours_since_success: null, runs_7d: 1 }),
      row({ feed_name: "phishstats", poll_schedule: "every 12h", last_success_at: null, hours_since_success: null, runs_7d: 22 }),
      row({ feed_name: "pfra_members", hours_since_success: 1972.9, runs_7d: 0, expect_new_rows_days: 30, days_since_useful: 88.2 }),
      // healthy
      row({ feed_name: "urlhaus", poll_schedule: "every 6h", expect_new_rows_days: 3 }),
      row({ feed_name: "ipsum", expect_new_rows_days: 3 }),
      row({ feed_name: "crtsh", days_since_useful: 54.4, new_rows_7d: 0 }),
      row({ feed_name: "feodo", poll_schedule: "every 12h", days_since_useful: 82.2, new_rows_7d: 0 }),
    ];

    const { problems, mutedCount } = classifyFeedHealth(fleet);

    expect(problems.map((p) => `${p.kind}:${p.feed_name}`)).toEqual([
      "absent:acnc_register",
      "never_succeeds:github_advisory",
      "never_succeeds:nvd_recent",
      "never_succeeds:phishstats",
      "stale:pfra_members",
    ]);
    expect(mutedCount).toBe(1);
  });
});
