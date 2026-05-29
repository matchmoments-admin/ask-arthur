import { inngest } from "@askarthur/scam-engine/inngest/client";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  runUrlBlocklistOnward,
  type OnwardStepCtx,
} from "@/lib/onward/url-blocklist-report";

/**
 * Onward destination: APWG eCrime Exchange (reportphishing@apwg.org).
 *
 * APWG accepts unsolicited phishing reports by email for free. We forward the
 * suspected phishing URL(s) + PII-redacted context, mirroring onward-acma.ts.
 *
 * Gated by FF_ONWARD_APWG (default OFF) + RESEND_API_KEY presence.
 * Conservative rate-limit so we read as a normal forwarder, not a firehose.
 */
const APWG_INTAKE = "reportphishing@apwg.org";

export const onwardApwg = inngest.createFunction(
  {
    id: "report-onward-apwg",
    concurrency: { limit: 2 },
    timeouts: { finish: "2m" },
    name: "Onward report: APWG eCrime Exchange",
    retries: 4,
    rateLimit: {
      limit: 60,
      period: "1h",
      key: "event.data.destination_key",
    },
  },
  { event: "report.onward.apwg" },
  async ({ event, step }) =>
    runUrlBlocklistOnward(
      // Inngest's step tools don't structurally match OnwardStepCtx (overloaded
      // generic run()); shapes are compatible at runtime.
      { event, step } as unknown as OnwardStepCtx,
      {
        intakeEmail: APWG_INTAKE,
        intakeName: "APWG",
        featureEnabled: featureFlags.onwardApwg,
        logFeature: "onward_apwg",
        logOperation: "apwg_url_forward",
      },
    ),
);
