// Shared constants for the install↔account link-token flow. Route files
// can't re-export these (Next.js restricts route.ts exports to handlers),
// so both /link-token (mint) and /link (consume) import from here.
export const LINK_TOKEN_PREFIX = "askarthur:ext:link:";
export const LINK_TOKEN_TTL_SECONDS = 600; // 10 minutes
