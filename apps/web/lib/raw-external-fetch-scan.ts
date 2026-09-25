// Detector for raw outbound HTTP — the rule behind
// __tests__/noRawExternalFetch.test.ts. Pure, so the test can go-red it
// against planted fixtures without touching the real tree.
//
// It reports CALL SITES (line + trimmed source line), not files, so an
// allowlisted file cannot quietly grow a second, unreviewed fetch.
//
// What counts as raw outbound HTTP:
//   - any value reference to `fetch` / `undiciFetch` that is not a property
//     access on some other object: `fetch(`, `fetch?.(`, `fetch<T>(`,
//     `fetch.call(`, `(fetch)(`, `const f = fetch`, `{ fetch }`
//   - `globalThis|window|self|global` + `.fetch` / `?.fetch` / `["fetch"]`
//   - `undici.request|stream|pipeline|fetch|connect(` and value imports of
//     those (or Client/Pool) from "undici"
//   - `http|https .get|request(` and get/request imports from node:http(s)
//   - axios / got / node-fetch / ky / superagent (import or require)
//
// Not counted: `x.fetch(` on another object (Supabase, a client), a property
// KEY named fetch (`{ fetch: impl }`, `fetch?: typeof fetch`), `typeof fetch`,
// a method DEFINITION named fetch, identifiers that merely contain the word
// (`safeFetch`, `prefetch`), and anything inside comments, strings or regex
// literals.

interface Tok {
  ch: string;
  /** Offset in the original source. */
  pos: number;
}

/** String contents kept verbatim: the names the patterns below look for. */
const KEPT_STRING =
  /^(?:fetch|undici|axios|got|node-fetch|ky|superagent|(?:node:)?https?)(?:\/[\w./-]*)?$/;

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS =
  /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Code with comments removed and string / template-text / regex contents
 * blanked, as characters mapped back to their source offsets. A string whose
 * whole content is an identifier (`"fetch"`, `"undici"`) is kept verbatim so
 * `globalThis["fetch"]` and import specifiers stay visible. Template `${…}`
 * expressions are code and are kept. '/" strings end at a newline, so a stray
 * apostrophe in JSX text cannot hide the rest of the file.
 */
export function codeTokens(src: string): Tok[] {
  const out: Tok[] = [];
  const push = (ch: string, pos: number) => out.push({ ch, pos });
  const prevSignificant = (): string => {
    for (let k = out.length - 1; k >= 0; k--) {
      if (!/\s/.test(out[k].ch)) return out[k].ch;
    }
    return "";
  };
  const tail = (): string => {
    let s = "";
    for (let k = out.length - 1; k >= 0 && s.length < 12; k--) s = out[k].ch + s;
    return s.trimEnd();
  };
  // Brace depth per open template `${`; when it closes, we are back in text.
  const templateStack: number[] = [];
  let braceDepth = 0;

  const readTemplateText = (start: number): number => {
    // src[start] is just after "`" or after the "}" closing a ${…}.
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        push("`", i);
        return i + 1;
      }
      if (c === "$" && src[i + 1] === "{") {
        push("$", i);
        push("{", i + 1);
        templateStack.push(braceDepth);
        braceDepth++;
        return i + 2;
      }
      i++;
    }
    return i;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      push(" ", i - 1);
    } else if (c === "/" && (REGEX_PRECEDERS.has(prevSignificant()) || prevSignificant() === "" || REGEX_KEYWORDS.test(tail()))) {
      // Regex literal: skip to the closing unescaped "/" outside a class.
      const start = i;
      i++;
      let inClass = false;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;
      push('"', start);
      push('"', i - 1);
    } else if (c === '"' || c === "'") {
      const start = i;
      i++;
      let content = "";
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") {
          content += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        content += src[i];
        i++;
      }
      push('"', start);
      if (KEPT_STRING.test(content)) {
        for (let k = 0; k < content.length; k++) push(content[k], start + 1 + k);
      }
      push('"', i);
      i++;
    } else if (c === "`") {
      push("`", i);
      i = readTemplateText(i + 1);
    } else if (c === "{") {
      braceDepth++;
      push(c, i);
      i++;
    } else if (c === "}") {
      braceDepth--;
      push(c, i);
      i++;
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        i = readTemplateText(i);
      }
    } else {
      push(c, i);
      i++;
    }
  }
  return out;
}

/** Collapse whitespace: a single space survives only between two word chars. */
function compact(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  const word = (ch: string | undefined) => !!ch && /[\w$]/.test(ch);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (/\s/.test(t.ch)) {
      const prev = out[out.length - 1]?.ch;
      let j = k + 1;
      while (j < toks.length && /\s/.test(toks[j].ch)) j++;
      if (word(prev) && word(toks[j]?.ch)) out.push({ ch: " ", pos: t.pos });
      k = j - 1;
      continue;
    }
    out.push(t);
  }
  return out;
}

export interface RawFetchSite {
  /** 1-based line of the offending token. */
  line: number;
  /** The trimmed source line — the allowlist key. */
  text: string;
  /** Which form matched. */
  form: string;
  /** A direct call whose first argument is a literal same-origin path
   *  ("/api/…", not "//host"): a browser component calling our own routes. */
  sameOrigin: boolean;
}

const FETCH_IDENT = /(?<![\w$])(fetch|undiciFetch)(?![\w$])/g;
const GLOBAL_OBJ = /(?:globalThis|window|self|global)(?:\?\.|\.)$/;

const EXTRA_PATTERNS: Array<[string, RegExp]> = [
  ["global[\"fetch\"]", /(?<![\w$])(?:globalThis|window|self|global)(?:\?\.)?\[["`]fetch["`]\]/g],
  ["undici.<call>", /(?<![\w$.])undici\.(?:request|stream|pipeline|fetch|connect)\(/g],
  [
    "undici value import",
    /import\{[^}]*(?<![\w$])(?:request|stream|pipeline|connect|Client|Pool)(?![\w$])[^}]*\}from"undici"/g,
  ],
  ["http(s).get/request", /(?<![\w$.])(?:https?|node_https?)\.(?:get|request)\(/g],
  [
    "node:http(s) get/request import",
    /import\{[^}]*(?<![\w$])(?:get|request)(?![\w$])[^}]*\}from"(?:node:)?https?"/g,
  ],
  ["http client library", /(?:from|require\()"(?:axios|got|node-fetch|ky|superagent)(?:\/[^"]*)?"/g],
  ["axios/got call", /(?<![\w$.])(?:axios|got)(?:\.(?:get|post|put|patch|delete|head|request|stream))?\(/g],
];

/** Index just past the balanced parens starting at `open` ("("), or -1. */
function skipParens(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")" && --depth === 0) return k + 1;
  }
  return -1;
}

function isRawFetchReference(code: string, start: number, end: number): boolean {
  const before = code.slice(Math.max(0, start - 14), start);
  const after = code.slice(end, end + 3);
  // A kept string literal ("fetch" as a step name); the quoted global form
  // is matched separately.
  if (/["`]$/.test(before)) return false;
  if (before.endsWith(".")) return GLOBAL_OBJ.test(before);
  if (/(?:^|[^\w$])typeof $/.test(before)) return false;
  // Property key / type member: `{ fetch: x }`, `fetch?: typeof fetch`.
  if (/^\??:/.test(after) && /[{,;(]$/.test(before)) return false;
  // Method definition: `fetch(req) {` / `async fetch(req): Promise<…> {`.
  const paren = code[end] === "(" ? end : code[end] === "<" ? code.indexOf("(", end) : -1;
  if (paren >= 0) {
    const close = skipParens(code, paren);
    if (close > 0 && /^[{:]/.test(code[close] ?? "")) {
      if (/(?:^|[{};,\s])(?:async )?$/.test(before) && !/[=(,:?]$/.test(before.trimEnd())) {
        return false;
      }
    }
  }
  // `function fetch(` declaration.
  if (/function $/.test(before)) return false;
  return true;
}

/** Every raw outbound-HTTP call site in `src`. */
export function rawFetchSites(src: string): RawFetchSite[] {
  const toks = compact(codeTokens(src));
  const code = toks.map((t) => t.ch).join("");
  const lines = src.split("\n");
  const lineStarts: number[] = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === "\n") lineStarts.push(k + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const sites: RawFetchSite[] = [];
  const seen = new Set<number>();
  const add = (codeIndex: number, form: string, sameOrigin = false) => {
    const line = lineOf(toks[codeIndex].pos);
    if (seen.has(codeIndex)) return;
    seen.add(codeIndex);
    sites.push({ line, text: lines[line - 1].trim(), form, sameOrigin });
  };
  // `fetch(` directly followed (in the ORIGINAL source) by "/x, '/x or `/x.
  const firstArgIsSamePath = (identEnd: number): boolean => {
    if (code[identEnd] !== "(") return false;
    const open = toks[identEnd].pos;
    const rest = src.slice(open + 1, open + 200).replace(/^\s+/, "");
    return /^["'`]\/(?!\/)/.test(rest);
  };

  for (const m of code.matchAll(FETCH_IDENT)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (isRawFetchReference(code, start, end)) add(start, m[1], firstArgIsSamePath(end));
  }
  for (const [form, re] of EXTRA_PATTERNS) {
    for (const m of code.matchAll(re)) {
      // globalThis["fetch"] also matches nothing above (the ident is quoted).
      add(m.index!, form);
    }
  }
  return sites.sort((a, b) => a.line - b.line);
}

/** Count form, kept for the detector cases. */
export function rawFetchCallCount(src: string): number {
  return rawFetchSites(src).length;
}
