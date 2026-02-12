import { Resend } from "resend";
import { render } from "@react-email/components";
import Welcome from "@/emails/Welcome";
import WeeklyDigest from "@/emails/WeeklyDigest";

function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.RESEND_FROM_EMAIL || "Ask Arthur <alerts@askarthur.ai>";

export async function sendWelcomeEmail(email: string): Promise<void> {
  const resend = getResendClient();
  const html = await render(Welcome());

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Welcome to Ask Arthur — You're on the list!",
    html,
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
          <a href="https://askarthur.ai" style="color: #0D9488;">askarthur.ai</a>
        </p>
        <p style="color: #94A3B8; font-size: 12px; margin-top: 24px;">
          You're receiving this because you subscribed to weekly scam alerts.
          <a href="https://askarthur.ai/unsubscribe" style="color: #94A3B8;">Unsubscribe</a>
        </p>
      </div>
    `;

  // Send in batches of 50
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    await Promise.allSettled(
      batch.map((email) =>
        resend.emails.send({
          from: FROM,
          to: email,
          subject: "This Week's Top Scams — Ask Arthur Weekly Alert",
          html,
        })
      )
    );
  }
}
