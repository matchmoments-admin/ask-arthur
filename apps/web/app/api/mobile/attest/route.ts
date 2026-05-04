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

  if (platform !== "android" && platform !== "ios") {
    return NextResponse.json(
      { error: "Unsupported platform" },
      { status: 400 }
    );
  }

  // Defense-in-depth: the FF gate above currently keeps this route inert in
  // production, but the verification logic below is a TODO that accepts any
  // token. If `featureFlags.deviceAttestation` is ever flipped on in prod
  // before Google Play Integrity / Apple App Attest verification is wired
  // up, this route would silently issue device tokens to anyone. Refuse
  // explicitly so an FF flip fails loudly instead of bypassing auth.
  if (process.env.NODE_ENV === "production") {
    logger.error(
      "device attestation route hit in production but verification is not implemented",
      { platform, tokenLength: token.length },
    );
    return NextResponse.json(
      { error: "Device attestation is not yet implemented in production" },
      { status: 501 }
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
    } else {
      // TODO: Verify App Attest attestation with Apple's server
      // Requires: POST to https://data.appattest.apple.com/v1/attestKey
      // For now, accept and log
      logger.info("iOS attestation token received", {
        tokenLength: token.length,
      });
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
