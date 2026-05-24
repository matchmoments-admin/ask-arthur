import { NextRequest, NextResponse } from "next/server";
import { logger } from "@askarthur/utils/logger";

// Hard 501 across all environments until real Google Play Integrity / Apple
// App Attest verification is wired up. The previous shape issued a deviceToken
// to any non-prod caller (verification was a TODO), which meant any downstream
// endpoint that trusts the token could be bypassed in dev/preview by anyone
// who could reach the route. A feature-flag gate doesn't help: flipping the
// flag would re-open the bypass. Track the real implementation as
// "Device attestation hardening" in BACKLOG.md.
export async function POST(req: NextRequest) {
  // Drain the body so clients get a 501 rather than a hung connection on
  // platforms where the runtime won't send a response until the request is
  // fully read.
  try {
    await req.text();
  } catch {
    /* ignore — we're refusing regardless */
  }

  logger.warn("Device attestation route called but verification is not implemented");

  return NextResponse.json(
    { error: "device_attestation_not_implemented" },
    { status: 501 },
  );
}
