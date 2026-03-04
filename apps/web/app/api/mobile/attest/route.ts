import { NextRequest, NextResponse } from "next/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export async function POST(req: NextRequest) {
  if (!featureFlags.deviceAttestation) {
    return NextResponse.json(
      { error: "Device attestation is not enabled" },
      { status: 404 }
    );
  }

  let body: { token: string; platform: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, platform } = body;
  if (!token || !platform) {
    return NextResponse.json(
      { error: "Missing token or platform" },
      { status: 400 }
    );
  }

  try {
    if (platform === "android") {
      // TODO: Verify Play Integrity token with Google's server-side API
      // Requires: google.apis.playintegrity.v1
      // For now, accept and log — full verification added when Google Cloud project is configured
      logger.info("Android attestation token received", {
        tokenLength: token.length,
      });
    } else if (platform === "ios") {
      // TODO: Verify App Attest attestation with Apple's server
      // Requires: POST to https://data.appattest.apple.com/v1/attestKey
      // For now, accept and log
      logger.info("iOS attestation token received", {
        tokenLength: token.length,
      });
    } else {
      return NextResponse.json(
        { error: "Unsupported platform" },
        { status: 400 }
      );
    }

    // Return a short-lived JWT (placeholder — wire up JWT signing when secrets are configured)
    const deviceToken = `dat_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    return NextResponse.json({
      deviceToken,
      expiresIn: 3600,
    });
  } catch (err) {
    logger.error("Device attestation verification failed", { error: err });
    return NextResponse.json(
      { error: "Attestation verification failed" },
      { status: 500 }
    );
  }
}
