// Runtime env-var readers — defeat two real failure modes observed in prod:
//
// 1. Trailing whitespace in Vercel-stored values. On 2026-05-26 several
//    `FF_SHOPFRONT_CLONE_*` vars were stored as `"true\n"` (5 chars)
//    instead of `"true"`. A strict equality check then silently failed
//    in prod for days. Same shape would land on a secret like
//    `ADMIN_SECRET` — login would 401 with no diagnostic.
//
// 2. Build-time inlining of `process.env.X`. Next.js / Webpack / Turbopack
//    DefinePlugin statically replaces `process.env.X` literals at build
//    time. For Vercel env vars not visible to the build (encrypted
//    secrets, late-added vars), this inlines as `undefined`. Using
//    `process.env[name]` (bracket + variable) defeats the static
//    replacement because the bundler can't constant-fold a dynamic
//    property access — the read happens at runtime where the value is
//    available.
//
// NEXT_PUBLIC_* flags MUST keep using the literal
// `process.env.NEXT_PUBLIC_X === "true"` pattern: the client bundle has no
// `process.env`, so it relies on build-time inlining to receive a value
// at all. Apply these helpers only to server-side flags and secrets.

export function readStringEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function readBoolEnv(name: string): boolean {
  return readStringEnv(name) === "true";
}

/**
 * True only on the Vercel **production** deployment.
 *
 * Vercel sets `VERCEL_ENV` to one of `production` | `preview` | `development`.
 * Preview/branch deployments (and local dev, where the var is absent) return
 * false. Bracket access defeats the build-time-inlining failure mode above.
 *
 * Use this to gate side-effecting scheduled work: Inngest creates a separate
 * branch environment per Vercel preview, and those previews share the
 * production secrets (admin Telegram chat id, Supabase service key), so an
 * unguarded cron fires into prod resources from every open preview. See the
 * cron guard in `@askarthur/scam-engine/inngest/with-axiom-logging`.
 */
export function isProductionDeployment(): boolean {
  return readStringEnv("VERCEL_ENV") === "production";
}
