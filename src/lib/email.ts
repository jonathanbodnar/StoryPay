// Shared email utility — tries SendGrid first, falls back to Resend

export async function sendEmail({
  to,
  replyTo,
  subject,
  html,
}: {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const resendKey   = process.env.RESEND_API_KEY;

  // Try SendGrid
  if (sendgridKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: 'noreply@storypay.io', name: 'StoryPay' },
          reply_to: replyTo ? { email: replyTo } : undefined,
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });
      if (res.status === 202) return { success: true };
      const err = await res.text();
      console.error('[email] SendGrid error:', res.status, err);
    } catch (err) {
      console.error('[email] SendGrid exception:', err);
    }
  }

  // Fallback: Resend
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'StoryPay <noreply@storypay.io>',
          to: [to],
          reply_to: replyTo,
          subject,
          html,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`[email] Resend sent to ${to}, id:`, data.id);
        return { success: true };
      }
      console.error('[email] Resend failed:', JSON.stringify(data));
      return { success: false, error: JSON.stringify(data) };
    } catch (err) {
      console.error('[email] Resend exception:', err);
    }
  }

  console.warn('[email] No email service configured (SENDGRID_API_KEY or RESEND_API_KEY)');
  return { success: false, error: 'No email service configured' };
}

// ─── Email templates ──────────────────────────────────────────────────────────

export function proposalEmailHtml({
  venueName,
  clientFirstName,
  proposalUrl,
  brandColor = '#1b1b1b',
  logoUrl,
}: {
  venueName: string;
  clientFirstName: string;
  proposalUrl: string;
  brandColor?: string;
  logoUrl?: string;
}): string {
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${venueName}" style="height:40px;object-fit:contain;margin-bottom:8px;display:block">`
    : '';
  return `
    <div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
      <div style="background-color:${brandColor};padding:28px 32px;border-radius:12px 12px 0 0">
        ${logoHtml}
        <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${venueName}</h1>
      </div>
      <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
          Hi ${clientFirstName},
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 28px">
          ${venueName} has sent you a proposal. Please review it, add your signature, and complete your payment to secure your date.
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="${proposalUrl}" style="display:inline-block;background-color:${brandColor};color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">
            View &amp; Sign Proposal
          </a>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:24px 0 0">
          If the button doesn't work, copy this link: <a href="${proposalUrl}" style="color:${brandColor}">${proposalUrl}</a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
          Sent via StoryPay on behalf of ${venueName}
        </p>
      </div>
    </div>
  `;
}

export function invoiceEmailHtml({
  venueName,
  clientFirstName,
  invoiceUrl,
  amount,
  brandColor = '#1b1b1b',
  logoUrl,
}: {
  venueName: string;
  clientFirstName: string;
  invoiceUrl: string;
  amount: string;
  brandColor?: string;
  logoUrl?: string;
}): string {
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${venueName}" style="height:40px;object-fit:contain;margin-bottom:8px;display:block">`
    : '';
  return `
    <div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
      <div style="background-color:${brandColor};padding:28px 32px;border-radius:12px 12px 0 0">
        ${logoHtml}
        <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${venueName}</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0">Invoice</p>
      </div>
      <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
          Hi ${clientFirstName},
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">
          You have a new invoice from ${venueName}.
        </p>
        <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin:20px 0;text-align:center">
          <p style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 4px">Amount Due</p>
          <p style="color:#111827;font-size:28px;font-weight:700;margin:0">${amount}</p>
        </div>
        <div style="text-align:center;margin:28px 0">
          <a href="${invoiceUrl}" style="display:inline-block;background-color:${brandColor};color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">
            View &amp; Pay Invoice
          </a>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:24px 0 0">
          If the button doesn't work: <a href="${invoiceUrl}" style="color:${brandColor}">${invoiceUrl}</a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
          Sent via StoryPay on behalf of ${venueName}
        </p>
      </div>
    </div>
  `;
}
