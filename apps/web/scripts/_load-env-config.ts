// Side-effect env loader — a drop-in for `import "dotenv/config"`.
//
// `dotenv/config` reads `.env`, which this repo does not have (values live in
// `.env.local`). Importing THIS module instead loads the real cascade
// (see _load-env.ts) as a side effect, preserving the "load env before any
// other import evaluates" ordering that a bare `import "…"` guarantees —
// which matters for scripts whose later imports read `process.env` at module
// load time (e.g. lib/bots/telegram/bot.ts reads TELEGRAM_BOT_TOKEN on
// import). Make this the FIRST import in a script.
import { loadEnv } from "./_load-env";

loadEnv();
