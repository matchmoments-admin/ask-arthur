// Safe numeric environment-variable coercion.
//
// Why this exists: `parseFloat(process.env.X ?? "DEFAULT")` silently
// returns NaN when X is set to a non-numeric value like "$10" or
// "10 USD". A downstream `cost > NaN` comparison is always false, so a
// typo in an operator-set env var disables the cost brake without a
// peep. See CLAUDE.md "Never Do" list — this was the third unaddressed
// item until 2026-05-11.
//
// `readNumberEnv` is pure: it never throws, never writes, never reads
// anything outside `process.env`. The caller decides how to surface
// invalid-value reports (cost_telemetry write, Telegram, etc.) — this
// keeps the helper trivially testable.

export interface NumberEnvResult {
  /** Resolved value: parsed env value when valid, otherwise `defaultValue`. */
  value: number;
  /** Set only when the env var was non-empty AND failed validation. */
  rawValue?: string;
  /** True iff the env var was provided but didn't parse to a non-negative
   *  finite number. False on undefined/empty (those fall back silently). */
  invalid: boolean;
}

/**
 * Read a non-negative numeric env var with a typed default.
 *
 * Rules:
 * - Missing or empty (after trim) → fall back to `defaultValue`, not invalid.
 * - Parses to a finite non-negative number → use it.
 * - Anything else (NaN, ±Infinity, negative, prefix like "$10") → fall
 *   back to `defaultValue` AND set `invalid: true` so the caller can log.
 *
 * Trimmed before parsing — "  10  " is fine.
 */
export function readNumberEnv(
  name: string,
  defaultValue: number,
): NumberEnvResult {
  const raw = process.env[name];
  if (raw === undefined) {
    return { value: defaultValue, invalid: false };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: defaultValue, invalid: false };
  }
  // Number() (not parseFloat) — parseFloat("10abc") === 10 silently, which
  // hides typos. Number("10abc") === NaN, which we'd treat as invalid.
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { value: defaultValue, rawValue: trimmed, invalid: true };
  }
  return { value: n, invalid: false };
}
