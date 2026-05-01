import { Resend } from "resend";
import { render } from "@react-email/components";
import Welcome from "@/emails/Welcome";
import WeeklyDigest from "@/emails/WeeklyDigest";
import WeeklyIntelDigest, {
  type WeeklyIntelDigestProps,
} from "@/emails/WeeklyIntelDigest";
import { signUnsubscribeUrl } from "@/lib/unsubscribe";
import { logCost, PRICING } from "@/lib/cost-telemetry";

function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.RESEND_FROM_EMAIL || "Ask Arthur <brendan@askarthur.au>";

export async function sendWelcomeEmail(email: string): Promise<void> {
  const resend = getResendClient();
  const html = await render(Welcome({ email }));
  const unsubscribeUrl = signUnsubscribeUrl(email, "https://askarthur.au/unsubscribe");
  const oneClickUrl = signUnsubscribeUrl(email, "https://askarthur.au/api/unsubscribe-one-click");

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Welcome to Ask Arthur — You're on the list!",
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>, <${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  logCost({
    feature: "email",
    provider: "resend",
    operation: "welcome",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
  });
}

interface ScamItem {
  brand: string;
  summary: string;
}

export async function sendWeeklyDigest(
  emails: string[],
  scamSummary: string,
  scams?: ScamItem[],
  blogUrl?: string
): Promise<void> {
  const resend = getResendClient();

  // If structured scams are provided, use React Email template
  // Otherwise fall back to the raw HTML summary for backward compatibility
  const useTemplate = scams && scams.length > 0;

  const html = useTemplate
    ? await render(WeeklyDigest({ scams, blogUrl }))
    : `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #1B2A4A; font-size: 24px; margin-bottom: 16px;">Weekly Scam Alert</h1>
        <div style="color: #334155; font-size: 16px; line-height: 1.6;">
          ${scamSummary}
        </div>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
        <p style="color: #334155; font-size: 16px;">
          Got a suspicious message? Check it free at
          <a href="https://askarthur.au" style="color: #0D9488;">askarthur.au</a>
        </p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 24px;">
          You're receiving this because you subscribed to weekly scam alerts.
          <a href="https://askarthur.au/unsubscribe" style="color: #94A3B8;">Unsubscribe</a>
        </p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 8px;">
          Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
        </p>
      </div>
    `;

  // Send in batches of 50
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    const results = await Promise.allSettled(
      batch.map((email) => {
        const unsubscribeUrl = signUnsubscribeUrl(email, "https://askarthur.au/unsubscribe");
        const oneClickUrl = signUnsubscribeUrl(email, "https://askarthur.au/api/unsubscribe-one-click");
        return resend.emails.send({
          from: FROM,
          to: email,
          subject: "This Week's Top Scams — Ask Arthur Weekly Alert",
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>, <${oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      })
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    if (fulfilled > 0) {
      logCost({
        feature: "email",
        provider: "resend",
        operation: "weekly-digest",
        units: fulfilled,
        unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
        metadata: { batch_size: batch.length, failed: batch.length - fulfilled },
      });
    }
  }
}

/**
 * Sends the Reddit-intel weekly digest. Subject is intentionally specific
 * (numeric specificity beats generic urgency per the source brief). Skips
 * the unsubscribe header on the brendan-only fallback path because the
 * recipient is the operator, not a list subscriber.
 */
export async function sendWeeklyIntelDigest(
  emails: string[],
  payload: WeeklyIntelDigestProps,
): Promise<void> {
  const resend = getResendClient();
  const html = await render(WeeklyIntelDigest(payload));

  const themeCount = payload.emergingThemes.length;
  const subject =
    themeCount > 0
      ? `[${themeCount} emerging scam${themeCount === 1 ? "" : "s"} in AU this week] — Ask Arthur Intel`
      : `Ask Arthur Intel — ${payload.totalPostsClassified} posts analysed this week`;

  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    const results = await Promise.allSettled(
      batch.map((email) => {
        const unsubscribeUrl = signUnsubscribeUrl(email, "https://askarthur.au/unsubscribe");
        const oneClickUrl = signUnsubscribeUrl(email, "https://askarthur.au/api/unsubscribe-one-click");
        return resend.emails.send({
          from: FROM,
          to: email,
          subject,
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>, <${oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      }),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    if (fulfilled > 0) {
      logCost({
        feature: "email",
        provider: "resend",
        operation: "weekly-intel-digest",
        units: fulfilled,
        unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
        metadata: {
          batch_size: batch.length,
          failed: batch.length - fulfilled,
          model_version: payload.modelVersion,
          prompt_version: payload.promptVersion,
        },
      });
    }
  }
}
