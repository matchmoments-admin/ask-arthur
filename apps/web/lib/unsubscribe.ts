import crypto from "crypto";

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.ADMIN_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET or ADMIN_SECRET not configured");
  return secret;
}

/** Generate a signed unsubscribe URL with HMAC token */
export function signUnsubscribeUrl(
  email: string,
  base: string
): string {
  const token = crypto
    .createHmac("sha256", getSecret())
    .update(email.toLowerCase())
    .digest("hex");
  return `${base}?email=${encodeURIComponent(email)}&token=${token}`;
}

/** Verify an unsubscribe HMAC token using timing-safe comparison */
export function verifyUnsubscribeToken(
  email: string,
  token: string
): boolean {
  try {
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(email.toLowerCase())
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(token, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}
