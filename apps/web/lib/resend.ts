import { Resend } from "resend";
import { render } from "@react-email/components";
import type { ReactElement } from "react";
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

/**
 * Sends the verdict reply for a user-forwarded "is this a scam?" email
 * (#252). Plain HTML template (intentionally not a React-Email component —
 * the surface is small and shouldn't carry the unsubscribe / digest
 * footers used by marketing email). Subject is "Re: <original>" so most
 * clients thread it under the forwarded message.
 *
 * Returns ok/error rather than throwing — the caller writes the outcome
 * to `email_forward_checks.reply_sent_at` / `reply_error` either way.
 */
export async function sendForwardCheckReply(args: {
  toEmail: string;
  originalSubject: string;
  verdict: "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK";
  reasoning: string;
  confidence?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { toEmail, originalSubject, verdict, reasoning, confidence } = args;
  const resend = getResendClient();

  const tone: Record<typeof verdict, { color: string; label: string; intro: string }> = {
    SAFE: {
      color: "#16a34a",
      label: "Looks safe",
      intro: "We found no signs of a scam in the message you forwarded.",
    },
    UNCERTAIN: {
      color: "#ca8a04",
      label: "Uncertain",
      intro: "There are some elements worth checking before you act on this.",
    },
    SUSPICIOUS: {
      color: "#ea580c",
      label: "Suspicious",
      intro: "This message has scam indicators. Treat it with caution.",
    },
    HIGH_RISK: {
      color: "#dc2626",
      label: "High risk — likely scam",
      intro: "This is very likely a scam. Do not click links, reply, or send money.",
    },
  };
  const pill = tone[verdict];
  const confidenceLine =
    typeof confidence === "number"
      ? `<p style="color:#64748b;font-size:12px;margin:16px 0 0;">Confidence: ${Math.round(confidence * 100)}%</p>`
      : "";

  const subject = `Re: ${originalSubject.slice(0, 200)} — ${pill.label}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;color:#0f172a;">
      <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${pill.color};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">${pill.label}</div>
      <h1 style="font-size:20px;margin:20px 0 8px;color:#0f172a;">Ask Arthur scam check</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${pill.intro}</p>
      <div style="border-left:3px solid ${pill.color};padding:12px 16px;background:#f8fafc;font-size:14px;line-height:1.6;color:#334155;">
        ${reasoning.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}
      </div>
      ${confidenceLine}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;"/>
      <p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">
        You sent this email to <strong>check@askarthur-inbound.com</strong>. We analysed the body
        you forwarded with the same engine that runs <a href="https://askarthur.au" style="color:#0d9488;">askarthur.au</a>.
        Verdicts are advisory — when in doubt, contact the sender through a channel you trust.
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:8px 0 0;">
        Ask Arthur · ABN 72 695 772 313 · Sydney, Australia
      </p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject,
      html,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    logCost({
      feature: "email-forward-check",
      provider: "resend",
      operation: "forward-check-reply",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
      metadata: { verdict },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sends a single nurture-series email to one lead. Centralises what the
 * cron route used to do inline so every nurture step gets the same
 * treatment as the weekly intel digest:
 *  - tokenised, signed unsubscribe URL (rather than the previous
 *    `?email=...` shape, which let any sender unsubscribe any address)
 *  - RFC 2369 List-Unsubscribe + RFC 8058 one-click POST headers
 *  - cost-telemetry log per send
 *
 * The nurture cron processes leads one at a time (small volume, per-lead
 * step timing), so this helper is single-recipient by design.
 */
export async function sendNurtureEmail(args: {
  email: string;
  subject: string;
  template: ReactElement;
  /** Schedule step (1–6) — recorded in cost telemetry for funnel analysis. */
  step: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { email, subject, template, step } = args;
  const resend = getResendClient();
  const unsubscribeUrl = signUnsubscribeUrl(
    email,
    "https://askarthur.au/unsubscribe",
  );
  const oneClickUrl = signUnsubscribeUrl(
    email,
    "https://askarthur.au/api/unsubscribe-one-click",
  );

  const html = await render(template);

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (result.error) {
      return { ok: false, error: result.error.message };
    }

    logCost({
      feature: "email",
      provider: "resend",
      operation: "nurture",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
      metadata: { step },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
