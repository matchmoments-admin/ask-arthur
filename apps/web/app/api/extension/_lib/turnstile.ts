import { logger } from "@askarthur/utils/logger";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  country?: string;
  errorCodes?: string[];
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("TURNSTILE_SECRET_KEY not set in production");
      return { success: false, errorCodes: ["missing-secret"] };
    }
    logger.warn("TURNSTILE_SECRET_KEY not set — allowing in dev");
    return { success: true };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
      country?: string;
    };
    return {
      success: data.success,
      country: data.country,
      errorCodes: data["error-codes"],
    };
  } catch (err) {
    logger.error("Turnstile siteverify failed", { error: err });
    return { success: false, errorCodes: ["network"] };
  }
}
