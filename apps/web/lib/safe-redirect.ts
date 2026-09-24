// The ONE check for a post-auth `next` / `redirectTo` target. Used on the
// server (auth confirm/callback routes, login page) and the client (LoginForm),
// so it has no server-only imports.
//
// Only a same-origin PATH is accepted: it must start with exactly one "/", and
// resolving it against a fixed base must not change the origin. Everything else
// (absolute URLs, protocol-relative "//host", backslash tricks, userinfo "@",
// control characters) falls back.

const BASE = "https://safe-redirect.invalid";

export function safeNextPath(
  next: string | null | undefined,
  fallback = "/app",
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) {
    return fallback;
  }
  // "//host" and "/\host" are protocol-relative to browsers; a raw backslash
  // anywhere is normalised to "/" by some of them.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
