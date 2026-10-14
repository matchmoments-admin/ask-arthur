import { serve } from "inngest/next";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { keepCloneWatchFunctions } from "@/lib/cloneWatchOnly";
import { allInngestFunctions } from "./registry";

// The function list lives in ./registry.ts (importable by tests).

// Each HTTP call to this endpoint runs ONE Inngest step. Some steps (the
// clone-watch batch loops) intentionally run up to ~200s of external I/O, so
// the Vercel function must be allowed to run at least as long as the Inngest
// step's finish budget — otherwise Vercel kills the invocation first and Inngest
// replays the whole step (re-burning urlscan quota, and previously risking a
// dropped weaponised event). 300s matches the batch steps' 5-8m finish budgets
// within the platform cap.
export const maxDuration = 300;

// Clone-Watch-only mode (docs/ops/clone-watch-only-mode.md): serve only the
// kept functions, so the next sync (PUT /api/inngest) deregisters the rest.
// Nothing is deleted — flag off + re-sync restores the full fleet.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: featureFlags.cloneWatchOnly
    ? keepCloneWatchFunctions(allInngestFunctions)
    : allInngestFunctions,
});
