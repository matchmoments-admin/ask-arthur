/**
 * The Clone Watch readiness scorecard (#1237) — scoring and the send gate.
 *
 * Founder decision (#1227, 2026-09-26): no brand is contacted until Clone Watch
 * is stable AND accurate, MEASURED, holding for consecutive months; then
 * AU/curated brands with monthly batch approval, in shadow until #371. This
 * module is the "measured" half: seven components, each scored pass / fail /
 * insufficient against a named threshold, and the gate every brand SEND path
 * checks in addition to its own flags.
 *
 * Pure: zero I/O. The reads live in readiness-data.ts; the table is v335's
 * clone_watch_readiness (whose CHECK makes `ready` true exactly when all seven
 * statuses are "pass").
 *
 * NULL means NOT MEASURED, never 0. A component whose source has no data reads
 * "insufficient", and insufficient makes the month NOT ready — but it is shown
 * as "insufficient data", never as "failed": the two call for different
 * actions (go and measure vs go and fix).
 */

// ── Founder-adjustable thresholds — ONE home ────────────────────────────────
//
// Proposed defaults from #1237. Change them here and only here; each written
// row records the thresholds in force when it was computed, so a change never
// silently re-scores history.

/** Consecutive closed months that must read ready before a real brand send. */
export const READINESS_REQUIRED_MONTHS = 2;

export const READINESS_THRESHOLDS = {
  /** Human-verified precision of weaponised / likely_phishing alerts. */
  precisionMin: 0.95,
  /** …needs at least this many human verdicts (tp + fp) to be judged. */
  precisionMinN: 10,
  /** fp share of every human-triaged alert. */
  fpShareMax: 0.25,
  /** …needs at least this many human-triaged alerts to be judged. */
  fpShareMinN: 10,
  /** Not-a-clone audit false-negative rate (misses / scanned, v330). */
  fnRateMax: 0.05,
  /** …needs at least this many scanned audit samples to be judged. */
  fnRateMinScanned: 30,
  /** Days in the month with any clone-watch lane problem. */
  laneProblemDaysMax: 2,
  /** …judged only when the digest measured at least this share of the month's
   *  days (a missed digest is an unmeasured day, not a clean one). */
  laneMinMeasuredShare: 0.8,
  /** Frozen store vs live recount: largest per-brand clone-count difference. */
  reportMaxBrandDiff: 1,
  /** …and at most this share of brands may differ at all. */
  reportMaxDiffBrandShare: 0.02,
  /** Takedown metric: negative durations allowed (none). */
  takedownMaxNegative: 0,
  /** Month-end stock: unverified share of the liveness snapshot. */
  stockMaxUnverifiedShare: 0.2,
} as const;

export type ReadinessThresholds = typeof READINESS_THRESHOLDS;

// ── Types ───────────────────────────────────────────────────────────────────

export type ComponentStatus = "pass" | "fail" | "insufficient";

export const READINESS_COMPONENTS = [
  "precision",
  "fp_share",
  "fn_rate",
  "lane_health",
  "report_diff",
  "takedown",
  "stock",
] as const;
export type ReadinessComponentKey = (typeof READINESS_COMPONENTS)[number];

export const COMPONENT_LABELS: Record<ReadinessComponentKey, string> = {
  precision: "Weaponised / likely-phishing precision",
  fp_share: "Lookalike false-positive share",
  fn_rate: "Not-a-clone false-negative rate",
  lane_health: "Lane health",
  report_diff: "Monthly report correctness",
  takedown: "Takedown metric validity",
  stock: "Month-end stock measured",
};

export interface ComponentResult {
  key: ReadinessComponentKey;
  status: ComponentStatus;
  /** The measured figure; null = not measured. */
  value: number | null;
  /** The sample it rests on; null = not measured. */
  n: number | null;
  /** The primary threshold the value is compared with. */
  threshold: number;
  /** One line for the admin page: why it passes, fails or is insufficient. */
  reason: string;
  /** Secondary thresholds and context figures (display only). */
  extra?: Record<string, unknown>;
}

/** The SQL-side inputs (v335 clone_watch_readiness_inputs). */
export interface TriageAndLaneInputs {
  human_triaged: number;
  human_fp: number;
  phishing_tp: number;
  phishing_fp: number;
  machine_fp: number;
  classified: number;
  classifier_rejected: number;
  window_days: number;
  measured_days: number;
  problem_days: number;
  problem_kinds: Record<string, number>;
  problem_lanes: string[];
}

export interface NotACloneInputs {
  sampled: number;
  scanned: number;
  misses: number;
}

export interface ReportDiffInputs {
  brandsCompared: number;
  maxDiff: number;
  brandsDiffering: number;
}

/** The raw clone_watch_takedown_stats row (v329) — the raw row, because the
 *  shared parser drops fastest/slowest, which is where a negative shows. */
export type TakedownRow = Record<string, unknown>;

export interface StockInputs {
  stock: number;
  unverified: number;
  completedAt: string | null;
}

/** Every input is nullable: null = the source could not be read / has no data. */
export interface ReadinessInputs {
  periodMonth: string; // YYYY-MM-01
  sql: TriageAndLaneInputs | null;
  notAClone: NotACloneInputs | null;
  /** null = the month is not frozen, or either side could not be read. */
  report: ReportDiffInputs | null;
  /** Why `report` is null, when it is. */
  reportUnavailable?: string;
  takedown: TakedownRow | null;
  stock: StockInputs | null;
}

export interface Scorecard {
  periodMonth: string;
  components: ComponentResult[];
  ready: boolean;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

function precision(
  sql: TriageAndLaneInputs | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "precision" as const, threshold: t.precisionMin };
  if (!sql) {
    return { ...base, status: "insufficient", value: null, n: null, reason: "Triage verdicts could not be read." };
  }
  const n = sql.phishing_tp + sql.phishing_fp;
  const extra = { min_n: t.precisionMinN, tp: sql.phishing_tp, fp: sql.phishing_fp };
  if (n < t.precisionMinN) {
    return {
      ...base,
      status: "insufficient",
      value: n > 0 ? round4(sql.phishing_tp / n) : null,
      n,
      reason: `${n} human verdict${n === 1 ? "" : "s"} on weaponised / likely-phishing alerts this month; ${t.precisionMinN} needed before precision is judged.`,
      extra,
    };
  }
  const value = round4(sql.phishing_tp / n);
  const pass = value >= t.precisionMin;
  return {
    ...base,
    status: pass ? "pass" : "fail",
    value,
    n,
    reason: `${pct(value)} of ${n} human-verified weaponised / likely-phishing alerts were real clones (needs ≥ ${pct(t.precisionMin)}).`,
    extra,
  };
}

function fpShare(
  sql: TriageAndLaneInputs | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "fp_share" as const, threshold: t.fpShareMax };
  if (!sql) {
    return { ...base, status: "insufficient", value: null, n: null, reason: "Triage verdicts could not be read." };
  }
  const n = sql.human_triaged;
  const extra = {
    min_n: t.fpShareMinN,
    classified: sql.classified,
    classifier_rejected: sql.classifier_rejected,
    classifier_rejected_share:
      sql.classified > 0 ? round4(sql.classifier_rejected / sql.classified) : null,
    machine_fp_excluded: sql.machine_fp,
  };
  const context =
    sql.classified > 0
      ? ` The pre-classifier rejected ${pct(sql.classifier_rejected / sql.classified)} of ${sql.classified} it judged (context, not scored).`
      : "";
  const machine =
    sql.machine_fp > 0
      ? ` ${sql.machine_fp} rule-based bulk rejects excluded — a rule is not a verdict.`
      : "";
  if (n < t.fpShareMinN) {
    return {
      ...base,
      status: "insufficient",
      value: n > 0 ? round4(sql.human_fp / n) : null,
      n,
      reason: `${n} alert${n === 1 ? "" : "s"} human-triaged this month; ${t.fpShareMinN} needed.${machine}${context}`,
      extra,
    };
  }
  const value = round4(sql.human_fp / n);
  return {
    ...base,
    status: value <= t.fpShareMax ? "pass" : "fail",
    value,
    n,
    reason: `${pct(value)} of ${n} human-triaged alerts were false positives (needs ≤ ${pct(t.fpShareMax)}).${machine}${context}`,
    extra,
  };
}

function fnRate(
  audit: NotACloneInputs | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "fn_rate" as const, threshold: t.fnRateMax };
  const extra = { min_scanned: t.fnRateMinScanned };
  if (!audit || audit.sampled === 0) {
    return {
      ...base,
      status: "insufficient",
      value: null,
      n: audit ? 0 : null,
      reason: audit
        ? "No not-a-clone audit sample drawn yet — the baseline is deferred until after the 1 Oct publish."
        : "The not-a-clone audit summary could not be read.",
      extra,
    };
  }
  if (audit.scanned < t.fnRateMinScanned) {
    return {
      ...base,
      status: "insufficient",
      value: audit.scanned > 0 ? round4(audit.misses / audit.scanned) : null,
      n: audit.scanned,
      reason: `${audit.scanned} of ${audit.sampled} audit samples scanned; ${t.fnRateMinScanned} needed.`,
      extra,
    };
  }
  const value = round4(audit.misses / audit.scanned);
  return {
    ...base,
    status: value <= t.fnRateMax ? "pass" : "fail",
    value,
    n: audit.scanned,
    reason: `${audit.misses} of ${audit.scanned} scanned not-a-clone samples were live phishing — ${pct(value)} (needs ≤ ${pct(t.fnRateMax)}).`,
    extra,
  };
}

function laneHealth(
  sql: TriageAndLaneInputs | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "lane_health" as const, threshold: t.laneProblemDaysMax };
  if (!sql) {
    return { ...base, status: "insufficient", value: null, n: null, reason: "Health-digest records could not be read." };
  }
  const extra = {
    window_days: sql.window_days,
    min_measured_share: t.laneMinMeasuredShare,
    problem_kinds: sql.problem_kinds,
    problem_lanes: sql.problem_lanes,
  };
  const kinds = Object.entries(sql.problem_kinds)
    .map(([k, d]) => `${k} ${d}d`)
    .join(", ");
  // A known failure is reported even from a partial month: once the measured
  // days already exceed the limit, the unmeasured ones cannot rescue it.
  if (sql.problem_days > t.laneProblemDaysMax) {
    return {
      ...base,
      status: "fail",
      value: sql.problem_days,
      n: sql.measured_days,
      reason: `${sql.problem_days} problem days in ${sql.measured_days} measured (${kinds}); limit ${t.laneProblemDaysMax}.`,
      extra,
    };
  }
  const minDays = Math.ceil(sql.window_days * t.laneMinMeasuredShare);
  if (sql.measured_days < minDays) {
    return {
      ...base,
      status: "insufficient",
      value: sql.measured_days > 0 ? sql.problem_days : null,
      n: sql.measured_days,
      reason: `The health digest measured ${sql.measured_days} of ${sql.window_days} days; ${minDays} needed (lane_problems is recorded from 2026-09-18).`,
      extra,
    };
  }
  return {
    ...base,
    status: "pass",
    value: sql.problem_days,
    n: sql.measured_days,
    reason:
      sql.problem_days === 0
        ? `No lane problem on any of ${sql.measured_days} measured days.`
        : `${sql.problem_days} problem day${sql.problem_days === 1 ? "" : "s"} (${kinds}) in ${sql.measured_days} measured; limit ${t.laneProblemDaysMax}.`,
    extra,
  };
}

function reportDiff(
  report: ReportDiffInputs | null,
  unavailable: string | undefined,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "report_diff" as const, threshold: t.reportMaxBrandDiff };
  const extra = { max_diff_brand_share: t.reportMaxDiffBrandShare };
  if (!report || report.brandsCompared === 0) {
    return {
      ...base,
      status: "insufficient",
      value: null,
      n: report ? 0 : null,
      reason: unavailable ?? "No frozen brand rows to compare.",
      extra,
    };
  }
  const share = report.brandsDiffering / report.brandsCompared;
  const pass =
    report.maxDiff <= t.reportMaxBrandDiff && share <= t.reportMaxDiffBrandShare;
  return {
    ...base,
    status: pass ? "pass" : "fail",
    value: report.maxDiff,
    n: report.brandsCompared,
    reason: `Frozen store vs live recount: max per-brand difference ${report.maxDiff}, ${report.brandsDiffering} of ${report.brandsCompared} brands differ (${pct(share)}); limits ${t.reportMaxBrandDiff} and ${pct(t.reportMaxDiffBrandShare)}.`,
    extra: { ...extra, brands_differing: report.brandsDiffering, differing_share: round4(share) },
  };
}

/** Every duration column v329 can return — a negative in ANY is invalid. */
const TAKEDOWN_DURATION_COLUMNS = [
  "median_minutes",
  "p90_minutes",
  "fastest_minutes",
  "slowest_minutes",
  "detect_to_block_median_minutes",
  "detect_to_block_p90_minutes",
  "detect_to_offline_median_minutes",
] as const;

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function takedown(
  row: TakedownRow | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "takedown" as const, threshold: t.takedownMaxNegative };
  if (!row) {
    return { ...base, status: "insufficient", value: null, n: null, reason: "clone_watch_takedown_stats could not be read." };
  }
  const total = numOrNull(row.takedowns_total);
  const timedN = numOrNull(row.timed_n);
  const detectN = numOrNull(row.detect_to_block_n);
  if (timedN === null || detectN === null) {
    // A v145-shaped row: its median mixes two clocks, so it is not a valid
    // measurement at all — insufficient, not a pass.
    return {
      ...base,
      status: "insufficient",
      value: null,
      n: total,
      reason: "The takedown row has no per-clock sample sizes (pre-v329 shape) — its durations are not a measurement.",
    };
  }
  const negatives = TAKEDOWN_DURATION_COLUMNS.filter((c) => {
    const v = numOrNull(row[c]);
    return v !== null && v < 0;
  });
  // The sample label is honest when a median exists exactly when its sample
  // does: a median with n = 0 is invented, and n > 0 with no median is lost.
  const dishonest: string[] = [];
  const triageMedian = numOrNull(row.median_minutes);
  const detectMedian = numOrNull(row.detect_to_block_median_minutes);
  if ((timedN > 0) !== (triageMedian !== null)) dishonest.push(`triage median vs timed_n=${timedN}`);
  if ((detectN > 0) !== (detectMedian !== null)) dishonest.push(`detect→block median vs n=${detectN}`);
  const pass = negatives.length <= t.takedownMaxNegative && dishonest.length === 0;
  const parts = [
    negatives.length === 0 ? "no negative durations" : `negative: ${negatives.join(", ")}`,
    dishonest.length === 0 ? "every median matches its sample" : `label mismatch: ${dishonest.join("; ")}`,
  ];
  return {
    ...base,
    status: pass ? "pass" : "fail",
    value: negatives.length,
    n: total,
    reason: `${total ?? 0} takedowns in the trailing ${numOrNull(row.window_days) ?? "?"} days (triage n=${timedN}, detect→block n=${detectN}); ${parts.join("; ")}.`,
    extra: { timed_n: timedN, detect_to_block_n: detectN, negative_columns: negatives, label_mismatches: dishonest },
  };
}

function stock(
  s: StockInputs | null,
  t: ReadinessThresholds,
): ComponentResult {
  const base = { key: "stock" as const, threshold: t.stockMaxUnverifiedShare };
  if (!s || s.completedAt === null) {
    return {
      ...base,
      status: "insufficient",
      value: null,
      n: s ? s.stock : null,
      reason: "No completed month-end liveness run (clone_liveness_runs) for this month.",
    };
  }
  if (s.stock === 0) {
    return { ...base, status: "insufficient", value: null, n: 0, reason: "The month-end run found no stock to verify." };
  }
  const value = round4(s.unverified / s.stock);
  return {
    ...base,
    status: value <= t.stockMaxUnverifiedShare ? "pass" : "fail",
    value,
    n: s.stock,
    reason: `Month-end snapshot complete: ${s.unverified} of ${s.stock} unverified (${pct(value)}; limit ${pct(t.stockMaxUnverifiedShare)}).`,
  };
}

/** Score one month. `ready` is true only when every component passes. */
export function scoreReadiness(
  input: ReadinessInputs,
  t: ReadinessThresholds = READINESS_THRESHOLDS,
): Scorecard {
  const components: ComponentResult[] = [
    precision(input.sql, t),
    fpShare(input.sql, t),
    fnRate(input.notAClone, t),
    laneHealth(input.sql, t),
    reportDiff(input.report, input.reportUnavailable, t),
    takedown(input.takedown, t),
    stock(input.stock, t),
  ];
  return {
    periodMonth: input.periodMonth,
    components,
    ready: components.every((c) => c.status === "pass"),
  };
}

/**
 * Frozen store vs live recount, per brand. A brand present on one side only
 * counts its whole clone count as the difference (missing = 0 clones).
 */
export function diffBrandClones(
  frozen: ReadonlyArray<{ brand: string; clones: number }>,
  live: ReadonlyArray<{ brand: string; clones: number }>,
): ReportDiffInputs {
  const f = new Map(frozen.map((r) => [r.brand, r.clones]));
  const l = new Map(live.map((r) => [r.brand, r.clones]));
  const brands = new Set([...f.keys(), ...l.keys()]);
  let maxDiff = 0;
  let brandsDiffering = 0;
  for (const b of brands) {
    const d = Math.abs((f.get(b) ?? 0) - (l.get(b) ?? 0));
    if (d > 0) brandsDiffering++;
    if (d > maxDiff) maxDiff = d;
  }
  return { brandsCompared: brands.size, maxDiff, brandsDiffering };
}

// ── Row mapping (clone_watch_readiness, v335) ───────────────────────────────

export type ReadinessRow = Record<string, unknown> & {
  period_month: string;
  ready: boolean;
  computed_at?: string;
};

export function toReadinessRow(card: Scorecard): ReadinessRow {
  const row: ReadinessRow = { period_month: card.periodMonth, ready: card.ready };
  const detail: Record<string, unknown> = {};
  for (const c of card.components) {
    row[`${c.key}_value`] = c.value;
    row[`${c.key}_n`] = c.n;
    row[`${c.key}_threshold`] = c.threshold;
    row[`${c.key}_status`] = c.status;
    detail[c.key] = { reason: c.reason, ...(c.extra ?? {}) };
  }
  row.detail = detail;
  return row;
}

const STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "insufficient"]);

/** Parse a stored row back into a scorecard (admin page). Unknown status → insufficient. */
export function fromReadinessRow(row: Record<string, unknown>): Scorecard & {
  computedAt: string | null;
} {
  const detail = (row.detail ?? {}) as Record<string, { reason?: string } & Record<string, unknown>>;
  const components = READINESS_COMPONENTS.map((key): ComponentResult => {
    const rawStatus = String(row[`${key}_status`] ?? "");
    const d = detail[key] ?? {};
    const { reason, ...extra } = d;
    return {
      key,
      status: STATUSES.has(rawStatus) ? (rawStatus as ComponentStatus) : "insufficient",
      value: numOrNull(row[`${key}_value`]),
      n: numOrNull(row[`${key}_n`]),
      threshold: numOrNull(row[`${key}_threshold`]) ?? 0,
      reason: typeof reason === "string" ? reason : "",
      extra,
    };
  });
  return {
    periodMonth: String(row.period_month).slice(0, 10),
    components,
    ready: row.ready === true,
    computedAt: typeof row.computed_at === "string" ? row.computed_at : null,
  };
}

// ── The send gate ───────────────────────────────────────────────────────────

export type ReadinessGate =
  | { ready: true; months: string[] }
  | { ready: false; months: string[]; reason: string };

/** The `n` closed months before `now`, newest first, as YYYY-MM-01 (UTC). */
export function requiredMonths(now: Date, n = READINESS_REQUIRED_MONTHS): string[] {
  const out: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The gate: a real brand send needs `ready === true` for EACH of the last
 * `required` closed months. `rows === null` means the scorecard could not be
 * read — that is NOT ready (fail closed); so is a missing month.
 */
export function evaluateReadinessGate(
  rows: ReadonlyArray<Record<string, unknown>> | null,
  now: Date,
  required = READINESS_REQUIRED_MONTHS,
): ReadinessGate {
  const months = requiredMonths(now, required);
  if (required < 1) {
    // A misconfigured constant must not open the gate.
    return { ready: false, months, reason: "READINESS_REQUIRED_MONTHS < 1" };
  }
  if (rows === null) {
    return { ready: false, months, reason: "scorecard_unreadable" };
  }
  const byMonth = new Map(
    rows.map((r) => [String(r.period_month).slice(0, 10), r.ready === true]),
  );
  const missing = months.filter((m) => !byMonth.has(m));
  if (missing.length > 0) {
    return { ready: false, months, reason: `not_computed:${missing.join(",")}` };
  }
  const notReady = months.filter((m) => byMonth.get(m) !== true);
  if (notReady.length > 0) {
    return { ready: false, months, reason: `not_ready:${notReady.join(",")}` };
  }
  return { ready: true, months };
}
