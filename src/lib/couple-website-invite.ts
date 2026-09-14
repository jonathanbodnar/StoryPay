import { RESEND_FROM_FALLBACK } from '@/lib/email';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Server-side helpers for the couple-side "Invite guests to your wedding
 * website" feature. Keep the from-address resolution, public site URL, guest
 * email sourcing, suppression checks and the branded email HTML all in one
 * place so the API route stays small.
 */

/** The public directory app (weddingdirectory) that renders the minisite at /<slug>. */
export function publicDirectoryBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
    process.env.NEXT_PUBLIC_DIRECTORY_URL ||
    'https://storyvenue.com'
  ).replace(/\/$/, '');
}

/** The StoryPay app origin (hosts the one-click unsubscribe endpoint). */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
}

/** Build the public URL for a published minisite slug. */
export function publicSiteUrlForSlug(slug: string): string {
  return `${publicDirectoryBaseUrl()}/${slug}`;
}

/** Extract the bare email address from a `"Name <email>"` or bare-email string. */
function emailFromFromString(raw: string): string {
  const m = /<([^>]+)>/.exec(raw);
  const candidate = (m ? m[1] : raw).trim();
  return candidate.includes('@') ? candidate : '';
}

/**
 * Resolve the From: address for couple website invites.
 *
 * Email portion comes from `RESEND_COUPLE_INVITE_FROM`, falling back to
 * `RESEND_DEFAULT_FROM` then `RESEND_FROM_FALLBACK` so a send always goes out
 * from a verified domain. The display name is always overridden to
 * "<Couple> via StoryVenue". Set RESEND_COUPLE_INVITE_FROM to
 * `weddings@mail.storyvenue.com` (and add mail.storyvenue.com to
 * RESEND_VERIFIED_DOMAINS) to activate the dedicated sending subdomain.
 */
export function resolveCoupleInviteFrom(coupleName: string): { name: string; email: string } {
  const raw =
    process.env.RESEND_COUPLE_INVITE_FROM?.trim() ||
    process.env.RESEND_DEFAULT_FROM?.trim() ||
    RESEND_FROM_FALLBACK;
  const email = emailFromFromString(raw) || emailFromFromString(RESEND_FROM_FALLBACK);
  const safeName = (coupleName || 'The couple').trim();
  return { name: `${safeName} via StoryVenue`, email };
}

/**
 * Neutralize any URL-like tokens a couple pastes into their invite subject or
 * message. The ONLY legitimate link in a website invite is the auto-added
 * "Visit our wedding website" button, so we strip everything else to a neutral
 * `[link removed]` placeholder BEFORE the text is escaped + rendered. Combined
 * with escapeHtml (which already prevents raw `<a>` injection), this guarantees
 * a phisher can never turn the note into a clickable link they control.
 *
 * We remove, in order:
 *   1. Full URLs with a scheme (http/https).
 *   2. `www.`-prefixed hosts.
 *   3. Bare `host.tld/path` tokens (a path makes intent unambiguous), e.g.
 *      `bit.ly/abc` or `evil.com/login`.
 *   4. Bare hosts with no path but a link-y TLD (curated list of the TLDs most
 *      used for links/shorteners) so ordinary prose with periods (e.g.
 *      "Mr.Smith", "8 a.m.") isn't mangled.
 *
 * A `(?<![@\w.])` lookbehind keeps us from eating the domain half of an email
 * address (e.g. `rsvp@gmail.com` stays intact) or the middle of a longer token.
 */
const LINK_PLACEHOLDER = '[link removed]';
const LINKY_TLDS =
  'com|net|org|io|co|xyz|link|info|app|site|online|click|live|me|ly|gg|to|biz|us|uk|ca|shop|store|page|dev';

export function neutralizeLinks(input: string): string {
  if (!input) return input;
  return input
    .replace(/\bhttps?:\/\/[^\s<>]+/gi, LINK_PLACEHOLDER)
    .replace(/\bwww\.[^\s<>]+/gi, LINK_PLACEHOLDER)
    .replace(/(?<![@\w.])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>]*/gi, LINK_PLACEHOLDER)
    .replace(
      new RegExp(`(?<![@\\w.])(?:[a-z0-9-]+\\.)+(?:${LINKY_TLDS})\\b`, 'gi'),
      LINK_PLACEHOLDER,
    );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A basic RFC-ish email check + normalization (lowercased, trimmed). */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export interface WebsiteInviteEmailParams {
  coupleName: string;
  /** Optional guest display name for a personal greeting. */
  guestName?: string | null;
  /** The bride's custom message (plain text; newlines become <br>). */
  message: string;
  /** Absolute public URL of the wedding website. */
  siteUrl: string;
  /** Plaintext site password to include, when the site is password-protected. */
  sitePassword?: string | null;
  /** ISO yyyy-mm-dd wedding date (optional, shown under the header). */
  weddingDate?: string | null;
  /** Per-recipient one-click unsubscribe URL. */
  unsubscribeUrl: string;
}

function formatWeddingDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Branded HTML for a wedding-website invite. Matches the house email style
 * (max-width 600, #1b1b1b header, "Sent via StoryVenue" footer) with a
 * prominent button to the site and an optional password line.
 */
export function buildWebsiteInviteHtml(params: WebsiteInviteEmailParams): string {
  const coupleName = (params.coupleName || 'The couple').trim();
  const firstName = (params.guestName || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  const bodyHtml = escapeHtml(params.message).replace(/\n/g, '<br>');
  const prettyDate = formatWeddingDate(params.weddingDate);

  const dateLine = prettyDate
    ? `<p style="margin:0 0 20px;font-size:14px;color:#6b7280">${escapeHtml(prettyDate)}</p>`
    : '';

  const passwordLine =
    params.sitePassword && params.sitePassword.trim()
      ? `<div style="margin:8px 0 0;padding:14px 18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px">
           <p style="margin:0;font-size:13px;color:#6b7280">Our site is password protected. Use this password to get in:</p>
           <p style="margin:6px 0 0;font-size:18px;font-weight:700;letter-spacing:.02em;color:#111827">${escapeHtml(
             params.sitePassword.trim(),
           )}</p>
         </div>`
      : '';

  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.7)">You're invited</p>
    <h1 style="color:#ffffff;font-size:24px;margin:0;font-weight:300;font-family:Georgia,'Times New Roman',serif">${escapeHtml(
      coupleName,
    )}</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    ${dateLine}
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">${greeting}</p>
    <div style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">${bodyHtml}</div>
    <div style="text-align:center;margin:32px 0 8px">
      <a href="${params.siteUrl}" style="display:inline-block;background-color:#1b1b1b;color:#ffffff;padding:14px 40px;border-radius:999px;text-decoration:none;font-weight:600;font-size:16px">
        Visit our wedding website
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0 0 4px">
      Or paste this link into your browser:<br><a href="${params.siteUrl}" style="color:#1b1b1b">${escapeHtml(
        params.siteUrl,
      )}</a>
    </p>
    ${passwordLine}
    <p style="margin:28px 0 0;font-size:14px;color:#6b7280">With love,<br>${escapeHtml(coupleName)}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      Sent via StoryVenue on behalf of ${escapeHtml(coupleName)}.<br>
      <a href="${params.unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline">Unsubscribe from these invites</a>
    </p>
  </div>
</div>`;
}

/** Load the set of suppressed (lowercased) emails for a couple's wedding. */
export async function loadCoupleSuppressions(coupleWeddingId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('couple_email_suppressions')
    .select('email')
    .eq('couple_wedding_id', coupleWeddingId);
  const out = new Set<string>();
  for (const row of (data ?? []) as { email: string | null }[]) {
    const e = (row.email ?? '').trim().toLowerCase();
    if (e) out.add(e);
  }
  return out;
}
