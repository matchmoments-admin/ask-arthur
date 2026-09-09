import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { render } from "@react-email/components";
import type { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import NewsletterConfirmation from "@/emails/NewsletterConfirmation";
import { signUnsubscribeUrl } from "@/lib/unsubscribe";
import { logCost, PRICING } from "@/lib/cost-telemetry";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

export function hashConfirmationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shared by signup and the legacy waitlist; neither may directly activate a row.
 * v303 atomically enforces recipient cooldown, global budget and the
 * newsletter_confirmation brake. Only a hash of the bearer token is stored.
 */
export async function requestNewsletterConfirmation(
  supabase: ServiceClient,
  email: string,
  source: string,
): Promise<void> {
  const apiKey = readStringEnv("RESEND_API_KEY");
  if (!apiKey) throw new Error("newsletter_delivery_unavailable");
  const unsubscribeUrl = signUnsubscribeUrl(email, "https://askarthur.au/unsubscribe");
  const oneClickUrl = signUnsubscribeUrl(email, "https://askarthur.au/api/unsubscribe-one-click");
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashConfirmationToken(token);
  // Fragment stays out of server/access logs and referrers. GET does not confirm:
  // the reader presses a button that POSTs the token, protecting against scanners.
  const confirmationUrl = `https://askarthur.au/subscribe/confirm#${token}`;
  const { data: shouldSend, error } = await supabase.rpc("request_newsletter_confirmation", {
    p_email: email,
    p_source: source,
    p_token_hash: tokenHash,
  });
  if (error) throw new Error("newsletter_store_unavailable");
  if (shouldSend === false) return; // Generic response: no subscription enumeration.
  if (shouldSend !== true) throw new Error("newsletter_store_unavailable");

  const html = await render(NewsletterConfirmation({ confirmationUrl, unsubscribeUrl }));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `newsletter-confirmation/${tokenHash}`,
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: readStringEnv("RESEND_FROM_EMAIL") || "Ask Arthur <brendan@askarthur.au>",
      to: [email],
      subject: "Confirm your email for Arthur’s Watch",
      html,
      text: `Confirm your email for Arthur’s Watch\n\nOne free weekly email to help you spot scams and take a practical next step.\n\nOpen this link, then press Confirm subscription (expires in 24 hours):\n${confirmationUrl}\n\nIf you did not request this, ignore it. You will not be subscribed by this request.\nStop these emails: ${unsubscribeUrl}`,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  const receipt = await response.json().catch(() => null);
  if (!response.ok || !receipt || typeof receipt.id !== "string") {
    // Never log provider payloads: they can contain recipient addresses.
    throw new Error("newsletter_delivery_failed");
  }
  try {
    logCost({
      feature: "newsletter_confirmation", provider: "resend", operation: "confirmation",
      units: 1, unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    });
  } catch {
    logger.warn("newsletter_confirmation_telemetry_failed");
  }
}
