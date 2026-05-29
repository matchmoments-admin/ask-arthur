import { inngest } from "@askarthur/scam-engine/inngest/client";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  runUrlBlocklistOnward,
  type OnwardStepCtx,
} from "@/lib/onward/url-blocklist-report";

/**
 * Onward destination: OpenPhish community blocklist (report@openphish.com).
 *
 * OpenPhish's free submission path is email — its REST submit endpoint
 * requires a static source IP we don't have on Vercel serverless. So we
 * forward the suspected phishing URL(s) by email, mirroring onward-acma.ts.
 *
 * Gated by FF_ONWARD_OPENPHISH (default OFF) + RESEND_API_KEY presence.
 * Conservative rate-limit so we read as a normal forwarder, not a firehose.
 */
const OPENPHISH_INTAKE = "report@openphish.com";

export const onwardOpenphish = inngest.createFunction(
  {
    id: "report-onward-openphish",
    concurrency: { limit: 2 },
    timeouts: { finish: "2m" },
    name: "Onward report: OpenPhish blocklist",
    retries: 4,
    rateLimit: {
      limit: 60,
      period: "1h",
      key: "event.data.destination_key",
    },
  },
  { event: "report.onward.openphish" },
  async ({ event, step }) =>
    runUrlBlocklistOnward(
      // Inngest's step tools don't structurally match OnwardStepCtx (overloaded
      // generic run()); shapes are compatible at runtime.
      { event, step } as unknown as OnwardStepCtx,
      {
        intakeEmail: OPENPHISH_INTAKE,
        intakeName: "OpenPhish",
        featureEnabled: featureFlags.onwardOpenphish,
        logFeature: "onward_openphish",
        logOperation: "openphish_url_forward",
      },
    ),
);
