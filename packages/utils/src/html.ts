/**
 * The ONE HTML-escaping Module. Every hand-built HTML string (admin Telegram
 * messages, email bodies, extension shadow-DOM cards) escapes through here.
 *
 * Before this Module ~21 private `escapeHtml` copies existed and they
 * disagreed: some escaped `" '` (attribute-safe), most escaped only `& < >`,
 * so whether an interpolation was safe inside an attribute depended on which
 * file you were in. `__tests__/htmlEscapingFitness.test.ts` (apps/web) fails
 * if a private copy reappears.
 *
 * Two levels:
 *   - `escapeHtml(str)` — escape one value for HTML text OR a double/single
 *     quoted attribute. Returns a plain string for callers that assemble
 *     strings (email templates).
 *   - `html\`…\`` — a tagged template that escapes every interpolation by
 *     default and returns a branded `SafeHtml`. Nested `SafeHtml` values pass
 *     through unescaped; `raw(str)` is the explicit escape hatch for markup
 *     that is trusted by construction. APIs that send HTML
 *     (`sendAdminTelegramMessage`) take `SafeHtml`, so a plain unescaped string
 *     no longer typechecks.
 */

/** Escape `& < > " '` — safe for HTML text and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Make a user-supplied string safe for a single-line email header value:
 * control characters (including CR/LF) become spaces, runs of whitespace
 * collapse, and the result is capped at `max` characters.
 */
export function headerSafe(value: string, max = 80): string {
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * HTML that is safe to send as-is: either built by `html\`…\`` (every
 * interpolation escaped) or explicitly marked with `raw()`. The private field
 * makes it impossible to forge from a plain object or string.
 */
export class SafeHtml {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** @internal — use `html`, `raw` or `joinHtml`. */
  static __from(value: string): SafeHtml {
    return new SafeHtml(value);
  }

  /** The rendered HTML string. */
  get value(): string {
    return this.#value;
  }

  toString(): string {
    return this.#value;
  }

  toJSON(): string {
    return this.#value;
  }
}

/** Anything `html` accepts as an interpolation. */
export type HtmlValue =
  | SafeHtml
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly HtmlValue[];

function render(value: HtmlValue): string {
  if (value instanceof SafeHtml) return value.value;
  // null / undefined / false render as nothing (so `${cond && html`…`}` works);
  // this also means an accidental undefined no longer prints "undefined".
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/**
 * Tagged template: literal parts are trusted markup, every `${…}` is escaped
 * unless it is already `SafeHtml`. Arrays render each item and join with "".
 */
export function html(
  strings: TemplateStringsArray,
  ...values: readonly HtmlValue[]
): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? "");
  }
  return SafeHtml.__from(out);
}

/**
 * Explicit escape hatch: mark `markup` as trusted HTML WITHOUT escaping it.
 * Only for markup that is trusted by construction (code literals, output of
 * another renderer that escapes) — never for data.
 */
export function raw(markup: string): SafeHtml {
  return SafeHtml.__from(markup);
}

/** Render `items` (each escaped unless SafeHtml) joined by `separator`. */
export function joinHtml(
  items: readonly HtmlValue[],
  separator: HtmlValue = "",
): SafeHtml {
  const sep = render(separator);
  return SafeHtml.__from(
    items
      .filter((i) => i !== null && i !== undefined && i !== false)
      .map(render)
      .join(sep),
  );
}
