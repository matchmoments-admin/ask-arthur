import { escapeHtml, headerSafe } from "@/lib/escape-html";

/**
 * Subject + HTML for an organisation invitation. `orgName` is set by the org's
 * creator, so it is escaped in the body and flattened/capped in the subject.
 */
export function buildOrgInviteEmail(args: {
  orgName: string;
  role: string;
  inviteUrl: string;
}): { subject: string; html: string } {
  const orgName = escapeHtml(args.orgName);
  const role = escapeHtml(args.role.replace("_", " "));
  const inviteUrl = escapeHtml(args.inviteUrl);
  return {
    subject: `You've been invited to join ${headerSafe(args.orgName)} on Ask Arthur`,
    html: `
          <div style="font-family: 'Public Sans', sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: #1B2A4A; padding: 24px 28px; border-radius: 8px 8px 0 0;">
              <p style="color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 0;">Ask Arthur</p>
            </div>
            <div style="background: #fff; padding: 28px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
              <h1 style="color: #1B2A4A; font-size: 24px; margin: 0 0 16px;">You've been invited</h1>
              <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                You've been invited to join <strong>${orgName}</strong> on Ask Arthur as a <strong>${role}</strong>.
              </p>
              <p style="margin: 24px 0;">
                <a href="${inviteUrl}" style="background: #0D9488; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Accept Invitation</a>
              </p>
              <p style="color: #64748B; font-size: 14px;">This invitation expires in 7 days.</p>
              <hr style="border-color: #E2E8F0; margin: 24px 0;" />
              <p style="color: #94A3B8; font-size: 12px;">Ask Arthur | ABN 72 695 772 313 | Sydney, Australia</p>
            </div>
          </div>
        `,
  };
}
