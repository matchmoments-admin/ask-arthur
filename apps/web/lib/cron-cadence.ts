/**
 * The longest gap between firings of a set of cron expressions, so a Lane's
 * health window is DERIVED from the schedule that actually triggers it rather
 * than hand-typed beside it ("9 * H // 6h cron + slack").
 *
 * Deliberately small: it understands the five-field forms the clone-watch
 * Lanes use — minute and hour as `*`, `N`, `a-b`, `* /N`, `a-b/N` or comma
 * lists; day-of-week the same (0 and 7 = Sunday); day-of-month and month must
 * be `*`. Anything else (a `TZ=` prefix, a monthly day-of-month) THROWS, so a
 * schedule this cannot reason about fails the build's tests instead of
 * silently getting a wrong window. Monthly Lanes declare `expectEvery`
 * explicitly.
 */

const MIN = 60_000;
const WEEK_MINUTES = 7 * 24 * 60;

function field(spec: string, lo: number, hi: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${name} field "${spec}" is not supported`);
    const step = m[2] ? Number(m[2]) : 1;
    let from = lo;
    let to = hi;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      from = a;
      to = b ?? (m[2] ? hi : a);
    }
    if (step < 1 || from < lo || to > hi || from > to) {
      throw new Error(`cron ${name} field "${spec}" is out of range`);
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** Minutes-of-week (0 = Sunday 00:00) at which `expr` fires. */
function firings(expr: string): number[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron "${expr}" must have five fields (no TZ= prefix)`);
  }
  const [mi, hr, dom, mon, dw] = parts;
  if (dom !== "*" || mon !== "*") {
    throw new Error(
      `cron "${expr}": day-of-month/month are not supported — declare expectEvery explicitly`,
    );
  }
  const minutes = field(mi, 0, 59, "minute");
  const hours = field(hr, 0, 23, "hour");
  const days = field(dw, 0, 7, "day-of-week");
  if (days.has(7)) days.add(0);
  const out: number[] = [];
  for (const d of days) {
    if (d === 7) continue;
    for (const h of hours) for (const m of minutes) out.push(d * 1440 + h * 60 + m);
  }
  return out;
}

/** Longest interval between consecutive firings of ANY of `exprs`, in ms. */
export function cronMaxGapMs(exprs: readonly string[]): number {
  if (exprs.length === 0) throw new Error("cronMaxGapMs: no cron expressions");
  const all = [...new Set(exprs.flatMap(firings))].sort((a, b) => a - b);
  let gap = all[0] + WEEK_MINUTES - all[all.length - 1]; // wrap-around
  for (let i = 1; i < all.length; i++) gap = Math.max(gap, all[i] - all[i - 1]);
  return gap * MIN;
}

const H = 3_600_000;

/**
 * The health window for a cron-driven Lane: the longest gap plus slack for
 * queueing and run time. Sub-daily lanes get half a gap (6h → 9h: ONE missed
 * run pages), daily-ish lanes two hours (24h → 26h), weekly a day (7d → 8d).
 * These reproduce the hand-typed windows they replace; the one tightening is
 * the twice-daily reconcile (26h → 18h), which now pages on one missed run
 * like every other sub-daily Lane.
 */
export function expectEveryFromCrons(exprs: readonly string[]): number {
  const gap = cronMaxGapMs(exprs);
  if (gap < 24 * H) return gap * 1.5;
  if (gap < 7 * 24 * H) return gap + 2 * H;
  return gap + 24 * H;
}
