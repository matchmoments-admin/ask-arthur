// Re-export of the shared Inngest client. There is exactly one Inngest app
// (`id: "askarthur"`); breach-defence cron functions register against the same
// instance the rest of the monorepo uses. Importing from here keeps call sites
// inside this package coherent without giving the impression that there's a
// separate Inngest app for breach defence.
export { inngest } from "@askarthur/scam-engine/inngest/client";
