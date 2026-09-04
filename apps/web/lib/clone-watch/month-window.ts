/**
 * Calendar-month windows for the monthly reporting surfaces.
 *
 * One home for three facts that were previously spread across an Inngest cron
 * and two near-identical builders inside report-card-data.ts: where a reported
 * month starts, where the month before it starts, and how a month is labelled
 * in prose. The two label builders were the same `toLocaleDateString("en-AU",
 * …)` call written out twice, which is exactly the kind of duplicate that stays
 * correct right up until someone changes one of them.
 *
 * Pure: no I/O, no imports. All arithmetic is UTC — the report is a UTC-month
 * report, and a local-time month boundary would silently move rows between
 * editions for anyone running it from Australia.
 */

export interface MonthWindow {
  /** Inclusive start, ISO. */
  startIso: string;
  /** Exclusive end, ISO — the next month's start. */
  endIso: string;
  /** `YYYY-MM-DD` month start, the key `clone_watch_report_summary` uses. */
  periodMonth: string;
  /** Human label, e.g. "August 2026". */
  label: string;
}

/** The first instant of the month BEFORE `now`. */
export function priorMonthStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
}

/** "August 2026" from a month-start Date. */
function monthLabel(start: Date): string {
  return start.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function windowFrom(start: Date): MonthWindow {
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    periodMonth: start.toISOString().slice(0, 10),
    label: monthLabel(start),
  };
}

/**
 * The reported month's window. `month` accepts `YYYY-MM` or `YYYY-MM-DD` and is
 * NORMALISED to the month start, so a full-date argument cannot produce a
 * partial-month window mislabelled as the whole month. Defaults to the prior
 * calendar month, which is what the 1st-of-month crons report on.
 *
 * Throws on a malformed month rather than returning an Invalid Date: every
 * comparison against NaN is false, so a downstream gate would skip its
 * rejection branches and pass everything (the same failure `brand-coverage.ts`
 * guards against).
 */
export function monthWindow(month?: string): MonthWindow {
  let start: Date;
  if (month) {
    const ym = month.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new Error(`invalid month "${month}" (expected YYYY-MM)`);
    }
    start = new Date(`${ym}-01T00:00:00Z`);
  } else {
    start = priorMonthStart(new Date());
  }
  if (Number.isNaN(start.getTime())) {
    throw new Error(`invalid month "${month}" (expected YYYY-MM)`);
  }
  return windowFrom(start);
}

/** The window immediately before `startIso` — the month-on-month comparison. */
export function priorWindow(startIso: string): MonthWindow {
  const cur = new Date(startIso);
  return windowFrom(
    new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1)),
  );
}
