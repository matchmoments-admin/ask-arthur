// Recovery for JSON that the model stopped writing at max_tokens.
//
// Claude serialises the analysis schema in prompt order, so when generation
// is cut off the fields that matter (verdict, confidence, summary, redFlags,
// nextSteps) are usually already complete and only the trailing block is
// half-written. Closing the open structures — and dropping whatever partial
// token the cut landed in — recovers a parseable object without inventing
// any content. Incident 2026-09-17: a forwarded email hit the cap inside
// `scammerContacts`, the naive `\{[\s\S]*\}` extraction ran to the last `}`
// and JSON.parse threw; the verdict it discarded parsed cleanly 4/4 once
// closed like this.

/**
 * Close a truncated JSON document so it parses. Returns the repaired text, or
 * null when no prefix of the input can be made to parse (e.g. nothing but an
 * opening brace survived).
 *
 * Strategy: drop any partial trailing token (an unterminated string, a
 * dangling key, a trailing comma), append the closers the bracket stack still
 * owes, and try JSON.parse. If that fails, cut back to the previous structural
 * delimiter and try again — each cut only ever removes content, so the result
 * is always a prefix of what the model actually wrote.
 */
export function closeTruncatedJson(text: string): string | null {
  let candidate = text;
  for (let attempt = 0; attempt < 64 && candidate.length > 0; attempt++) {
    const closed = closeOpenStructures(candidate);
    try {
      JSON.parse(closed);
      return closed;
    } catch {
      const cut = Math.max(
        candidate.lastIndexOf(","),
        candidate.lastIndexOf("["),
        candidate.lastIndexOf("{"),
      );
      if (cut <= 0) return null;
      candidate = candidate.slice(0, cut);
    }
  }
  return null;
}

function closeOpenStructures(text: string): string {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringStart = i;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  // A cut inside a string leaves a partial value or key — drop it rather
  // than ship half a sentence as a red flag.
  let out = inString ? text.slice(0, stringStart) : text;
  out = out.replace(/\s+$/, "").replace(/,$/, "");
  // A complete key with no value (`"emailAddresses":` or `"emailAddresses"`)
  // cannot be closed into anything valid — drop it too.
  out = out.replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, "$1").replace(/,$/, "");

  const closers = stack
    .reverse()
    .map((open) => (open === "{" ? "}" : "]"))
    .join("");
  return out + closers;
}
