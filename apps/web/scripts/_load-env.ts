/**
 * Env loader for the dev scripts.
 *
 * `import "dotenv/config"` — the pattern the older scripts use — only reads
 * `.env`, and this repo has no `.env`: the real values live in `.env.local`
 * (apps/web and/or repo root). So that import silently loads NOTHING and the
 * script dies on "missing SUPABASE_*" while the values are sitting right
 * there. Load the actual cascade instead.
 *
 * Order is most-specific-first and dotenv never overrides an already-set
 * variable, so: exported shell vars > apps/web/.env.local > repo root. Paths
 * cover both `pnpm --filter @askarthur/web <script>` (cwd = apps/web) and
 * `npx tsx apps/web/scripts/<script>.ts` (cwd = repo root).
 */
import dotenv from "dotenv";
import path from "node:path";

const CANDIDATES = [
  ".env.local",
  ".env",
  "../../.env.local", // repo root, when cwd = apps/web
  "../../.env",
  "apps/web/.env.local", // when cwd = repo root
  "apps/web/.env",
];

export function loadEnv(): void {
  for (const candidate of CANDIDATES) {
    dotenv.config({ path: path.resolve(process.cwd(), candidate), quiet: true });
  }
}

/** Fail loudly and usefully — naming the files we actually looked in. */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length === 0) return;
  console.error(`\n❌ Missing required env var(s): ${missing.join(", ")}`);
  console.error(`   Looked in (relative to ${process.cwd()}):`);
  for (const c of CANDIDATES) console.error(`     - ${c}`);
  console.error("");
  process.exit(1);
}
