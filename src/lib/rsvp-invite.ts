import { sendEmail } from '@/lib/email';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

export function rsvpUrlForToken(token: string): string {
  return `${APP_URL}/rsvp/${token}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWeddingDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface RsvpInviteParams {
  /** Guest recipient email. */
  to: string;
  /** Guest's first name / display name for the greeting. */
  guestName: string;
  /** Couple display name, e.g. "Ali & Jordan". */
  coupleName: string;
  /** Per-guest RSVP token. */
  token: string;
  /** ISO yyyy-mm-dd wedding date (optional). */
  weddingDate?: string | null;
  /** Venue name (optional, for context). */
  venueName?: string | null;
  /** Couple's own email so guest replies reach them. */
  replyTo?: string | null;
}

/**
 * Send a branded "please RSVP" email to a single guest. The email comes from the
 * couple's name (via the verified StoryVenue domain) with the couple's own email
 * as Reply-To so guest replies land with them.
 */
export async function sendRsvpInvite(params: RsvpInviteParams) {
  const rsvpUrl = rsvpUrlForToken(params.token);
  const firstName = (params.guestName || '').trim().split(/\s+/)[0] || 'there';
  const prettyDate = formatWeddingDate(params.weddingDate);
  const coupleName = params.coupleName?.trim() || 'The couple';

  const dateLine = prettyDate
    ? `<p style="margin:0 0 4px;font-size:15px;color:#6b7280">${esc(prettyDate)}</p>`
    : '';
  const venueLine = params.venueName
    ? `<p style="margin:0;font-size:15px;color:#6b7280">${esc(params.venueName)}</p>`
    : '';

  const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:linear-gradient(135deg,#8b6f47 0%,#3f3a34 100%);padding:40px 32px;border-radius:16px 16px 0 0;text-align:center">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.75)">You're invited</p>
    <h1 style="margin:0;color:#fff;font-size:28px;font-weight:400;font-family:Georgia,'Times New Roman',serif">${esc(coupleName)}</h1>
  </div>
  <div style="padding:32px;border:1px solid #ecebe8;border-top:none;border-radius:0 0 16px 16px;text-align:center">
    ${dateLine}
    ${venueLine}
    <p style="margin:24px 0 8px;font-size:15px;line-height:1.7;color:#374151">Hi ${esc(firstName)}, we'd love to celebrate with you. Please let us know if you can make it.</p>
    <div style="margin:28px 0">
      <a href="${rsvpUrl}" style="display:inline-block;background:#1b1b1b;color:#fff;text-decoration:none;padding:14px 40px;border-radius:999px;font-weight:600;font-size:16px">RSVP now</a>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af">Or paste this link into your browser:<br><a href="${rsvpUrl}" style="color:#8b6f47">${rsvpUrl}</a></p>
  </div>
  <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#c4c1bb">Sent with StoryVenue</p>
</div>`;

  return sendEmail({
    to: params.to,
    from: { name: coupleName },
    replyTo: params.replyTo?.trim() || undefined,
    subject: `${coupleName} — please RSVP`,
    html,
  });
}
