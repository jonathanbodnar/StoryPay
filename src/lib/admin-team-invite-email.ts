/**
 * Sends the welcome / re-invite email to a StoryVenue admin team member.
 *
 * Used by:
 *   - POST /api/admin/team-members           (initial invite)
 *   - POST /api/admin/team-members/[id]/resend  (manual resend from the UI)
 *
 * Deliberately decoupled from the main email lib so we can tweak the template
 * (subject line, copy, branding) without touching transactional plumbing.
 */

import { sendEmail } from './email';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface AdminInviteEmailOptions {
  to: string;
  firstName: string;
  password: string;
  isSuperAdmin: boolean;
  /** True when this is a "resend" — subject becomes a polite reminder. */
  isReinvite?: boolean;
}

export async function sendAdminInviteEmail(
  opts: AdminInviteEmailOptions,
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const loginUrl = `${baseUrl}/admin`;
  const access = opts.isSuperAdmin
    ? 'Super admin (full access to every tab + team management)'
    : 'Limited access — your assigned tabs only';

  const subject = opts.isReinvite
    ? 'Your StoryVenue admin login (resent)'
    : 'Welcome to the StoryVenue admin panel';
  const headline = opts.isReinvite
    ? `Hi ${escapeHtml(opts.firstName)}, here's your admin login again.`
    : `Welcome aboard, ${escapeHtml(opts.firstName)}.`;
  const intro = opts.isReinvite
    ? `Your StoryVenue super-admin invite was resent — use the credentials below to sign in. The temporary password may have been refreshed by your inviter.`
    : `You've been invited to the StoryVenue super admin panel. Use the credentials below to sign in — please change your password the first time you log in.`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0;font-size:12px;letter-spacing:1.5px;color:#9ca3af;text-transform:uppercase;font-weight:600;">StoryVenue &middot; Super Admin</p>
          <h1 style="margin:14px 0 4px;font-size:22px;color:#111827;font-weight:600;">${headline}</h1>
          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.55;">${intro}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
            <tr><td style="padding:16px 18px;">
              <p style="margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Email</p>
              <p style="margin:0 0 14px;font-size:14px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(opts.to)}</p>
              <p style="margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Temporary password</p>
              <p style="margin:0;font-size:14px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(opts.password)}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Access level</p>
          <p style="margin:0;font-size:14px;color:#111827;">${escapeHtml(access)}</p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 32px;">
          <a href="${loginUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;">Sign in to admin panel</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;border-top:1px solid #f3f4f6;">
          <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;line-height:1.55;">
            If you didn't expect this invite, you can ignore this email. Questions? Reply to this message.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  console.log(`[admin-team] sending ${opts.isReinvite ? 'resend' : 'invite'} email to ${opts.to}`);
  const result = await sendEmail({
    to: opts.to,
    subject,
    html,
    replyTo: process.env.ADMIN_REPLY_TO || undefined,
    headers: { 'X-Entity-Ref-ID': `storyvenue-admin-invite-${Date.now()}` },
  });
  if (result.success) {
    console.log(`[admin-team] email accepted by Resend for ${opts.to}`);
  } else {
    console.error(`[admin-team] email FAILED for ${opts.to}: ${result.error}`);
  }
  return result;
}
