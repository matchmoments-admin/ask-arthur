// Detector for raw model-SDK usage — the rule behind
// __tests__/noRawModelCalls.test.ts. Kept as a pure function so the test can
// go-red it against planted fixtures without touching the real tree.

/** Remove comments and the contents of string/template literals, so a
 *  sample rendered as text (or a comment mentioning the SDK) is not a call,
 *  while the literal of an import specifier is kept (checked separately). */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
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
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      out += `${q}${q}`;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Module specifiers that give direct model access. */
const SDK_SPECIFIERS = ["@anthropic-ai/sdk", "@ai-sdk/anthropic", "@anthropic-ai/bedrock-sdk", "@anthropic-ai/vertex-sdk"];

/** Reasons a source file is a raw model call. Empty = clean. */
export function rawModelCallReasons(src: string): string[] {
  const reasons: string[] = [];
  // Value imports / requires of an SDK package (import type is allowed).
  for (const spec of SDK_SPECIFIERS) {
    const q = spec.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
    const importRe = new RegExp(
      `(^|[\\n;])\\s*import\\s+(?!type\\b)[^;]*?from\\s*["']${q}(?:/[^"']*)?["']`,
    );
    const bareImportRe = new RegExp(`(^|[\\n;])\\s*import\\s*["']${q}(?:/[^"']*)?["']`);
    const requireRe = new RegExp(`\\brequire\\s*\\(\\s*["']${q}(?:/[^"']*)?["']\\s*\\)`);
    const dynImportRe = new RegExp(`\\bimport\\s*\\(\\s*["']${q}(?:/[^"']*)?["']\\s*\\)`);
    if (importRe.test(src) || bareImportRe.test(src) || requireRe.test(src) || dynImportRe.test(src)) {
      reasons.push(`value import of ${spec}`);
    }
  }
  // Patterns are built from strings (whose contents the scanner strips), so
  // this file does not match its own rules.
  if (new RegExp(["api", "anthropic", "com"].join("\\.")).test(src)) {
    reasons.push("literal API host");
  }

  // Call shapes, on code with comments/strings removed and whitespace
  // collapsed, so `client.messages\n  .create(` is caught.
  const code = stripCommentsAndStrings(src).replace(/\s+/g, "");
  const sdkClass = "Anthropic(?:Bedrock|Vertex)?";
  if (new RegExp(`new${sdkClass}\\(`).test(code)) reasons.push("SDK client construction");
  if (new RegExp(`\\b${"Anthropic"}(?:Bedrock|Vertex)\\b`).test(code)) {
    reasons.push("Bedrock/Vertex client");
  }
  if (new RegExp(["\\.messages", "(?:\\.batches)?", "\\.(?:create|stream)\\("].join("")).test(code)) {
    reasons.push("messages call");
  }
  return reasons;
}
