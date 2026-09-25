// Detector for raw `fetch(` calls — the rule behind
// __tests__/noRawExternalFetch.test.ts. Pure, so the test can go-red it
// against planted fixtures without touching the real tree.

import { stripCommentsAndStrings } from "@/lib/raw-model-call-scan";

/** Number of direct `fetch(` calls in a source file (comments and string
 *  contents ignored, whitespace collapsed). `globalThis.fetch(` /
 *  `window.fetch(` / `self.fetch(` count; `client.fetch(` (a method on some
 *  other object) does not. */
export function rawFetchCallCount(src: string): number {
  // Collapse whitespace to ONE space (not none — `await fetch(` must keep its
  // token boundary), then match `fetch(` not preceded by an identifier char or
  // a member dot, optionally qualified by a global object.
  const code = stripCommentsAndStrings(src).replace(/\s+/g, " ");
  const re = /(?<!\.\s?)(?<![\w$])(?:(?:globalThis|window|self)\s?\.\s?)?fetch\s?\(/g;
  return code.match(re)?.length ?? 0;
}
