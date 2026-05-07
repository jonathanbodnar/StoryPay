// Transactional email — Resend only (https://resend.com/docs/send-with-nextjs)
// Requires RESEND_API_KEY. Set RESEND_DEFAULT_FROM on the host (e.g. Railway) — verified in Resend.

/** Used when `RESEND_DEFAULT_FROM` is unset (e.g. local). Production: set env to your verified address. */
export const RESEND_FROM_FALLBACK = 'StoryVenue <noreply@storyvenue.com>';

/**
 * Convert HTML to a reasonable plain-text alternative for the email's `text`
 * part. Spam filters heavily downrank multipart/alternative messages that
 * have no text body, so we always include one — auto-generated when the
 * caller doesn't provide one.
 *
 * The output is intentionally minimal: drop `<style>`/`<script>` blocks,
 * preserve link URLs, convert headings/paragraphs to newlines, and collapse
 * whitespace. Not perfect — but dramatically better than no text part.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, label) => {
      const text = String(label || '').replace(/<[^>]+>/g, '').trim();
      return text && text !== url ? `${text} (${url})` : url;
    })
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>(?:\s*<br\s*\/?>)+/gi, '\n\n')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<li[^>]*>/gi, ' • ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build the deliverability header bag for a marketing/bulk email.
 *
 * - `List-Unsubscribe` (RFC 2369) — both `mailto:` and `https:` variants are
 *   provided; Gmail/Yahoo strongly prefer messages that expose at least one
 *   of these (the HTTPS one is required for the one-click flow below).
 * - `List-Unsubscribe-Post` (RFC 8058) — the "one-click" magic value Gmail
 *   uses to render the inbox-level "Unsubscribe" button. Without this header
 *   the button is hidden and the message is more likely to be flagged as
 *   bulk by ML filters.
 * - `Precedence: bulk` — long-standing convention that tells receiving MTAs
 *   "this is a bulk message; don't bounce vacation auto-replies back to me."
 *
 * Pass the result through `sendEmail({ headers })`.
 */
export function buildBulkEmailHeaders(unsubscribeUrl: string | null | undefined, mailtoUnsub?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Precedence': 'bulk',
    'X-Entity-Ref-ID': `storyvenue-${Date.now()}`,
  };
  const parts: string[] = [];
  if (mailtoUnsub) parts.push(`<mailto:${mailtoUnsub}?subject=unsubscribe>`);
  if (unsubscribeUrl) parts.push(`<${unsubscribeUrl}>`);
  if (parts.length) {
    headers['List-Unsubscribe'] = parts.join(', ');
    if (unsubscribeUrl) {
      // RFC 8058 one-click. Only add when an HTTPS endpoint is present.
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
  }
  return headers;
}

function normalizeEmailList(list: string[] | undefined): string[] {
  if (!list?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (!e || !e.includes('@')) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(raw.trim());
  }
  return out;
}

/** Parse `"Name <email@domain.com>"` or bare `email@domain.com`. */
function parseFromString(raw: string): { header: string; email: string } {
  const s = raw.trim();
  const m = /^(.+?)\s*<([^>]+)>$/u.exec(s);
  if (m) {
    const name = m[1].replace(/^["']|["']$/g, '').trim();
    const email = m[2].trim();
    return {
      email,
      header: name ? `${name} <${email}>` : email,
    };
  }
  if (s.includes('@')) {
    return { header: s, email: s };
  }
  return parseFromString(RESEND_FROM_FALLBACK);
}

function getDefaultFrom(): { header: string; email: string } {
  const raw = process.env.RESEND_DEFAULT_FROM?.trim() || RESEND_FROM_FALLBACK;
  return parseFromString(raw);
}

/**
 * Send HTML email via Resend.
 * For conversations Reply-To routing, pass `replyTo` (e.g. reply+thread+sig@your-inbound-domain).
 *
 * If you pass `from.name` without `from.email` (e.g. venue display name, no brand_email yet),
 * the **email address** comes from RESEND_DEFAULT_FROM so the inbox shows the venue name
 * with your verified domain.
 */
export async function sendEmail({
  to,
  cc,
  bcc,
  replyTo,
  subject,
  html,
  text,
  from,
  headers,
}: {
  to: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  /** Plain-text alternative. When omitted we auto-generate one from `html` so
   *  every message ships as multipart/alternative — major deliverability win. */
  text?: string;
  /** Overrides default from; use a domain you verified in Resend (e.g. `Acme <mail@yourdomain.com>`). */
  from?: { email?: string; name?: string };
  /** Custom headers (e.g. List-Unsubscribe, Precedence). */
  headers?: Record<string, string>;
}): Promise<{ success: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.warn('[email] RESEND_API_KEY is not set');
    return { success: false, error: 'Email not configured (RESEND_API_KEY)' };
  }

  const def = getDefaultFrom();
  const fromEmail = from?.email?.trim();
  const fromName = from?.name?.trim();

  let fromHeader: string;
  if (fromEmail && fromName) {
    fromHeader = `${fromName} <${fromEmail}>`;
  } else if (fromEmail) {
    fromHeader = fromEmail;
  } else if (fromName) {
    fromHeader = `${fromName} <${def.email}>`;
  } else {
    fromHeader = def.header;
  }

  const ccList = normalizeEmailList(cc);
  const bccList = normalizeEmailList(bcc);

  // Always ship a plain-text alternative. Major spam filters (Gmail, Outlook,
  // SpamAssassin) penalize HTML-only messages because legitimate marketing
  // and transactional senders virtually always include both parts.
  const textBody = (text && text.trim().length > 0) ? text : htmlToPlainText(html);

  try {
    const body: Record<string, unknown> = {
      from: fromHeader,
      to: [to.trim()],
      subject,
      html,
      text: textBody,
    };
    if (ccList.length) body.cc = ccList;
    if (bccList.length) body.bcc = bccList;
    if (replyTo?.trim()) body.reply_to = replyTo.trim();
    if (headers && Object.keys(headers).length > 0) body.headers = headers;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { id?: string; message?: string; name?: string };
    if (res.ok) {
      console.log(`[email] Resend sent to ${to}, id:`, data.id);
      return { success: true };
    }
    const errMsg = typeof data.message === 'string' ? data.message : JSON.stringify(data);
    console.error('[email] Resend failed:', res.status, errMsg);
    return { success: false, error: errMsg };
  } catch (err) {
    console.error('[email] Resend exception:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Send failed' };
  }
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
          Sent via StoryVenue on behalf of ${venueName}
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
          Sent via StoryVenue on behalf of ${venueName}
        </p>
      </div>
    </div>
  `;
}
