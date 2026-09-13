import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sendEmail, buildBulkEmailHeaders, htmlToPlainText } from '@/lib/email';
import { verifySitePassword } from '@/lib/couple-sites';
import { signCoupleUnsubscribeToken } from '@/lib/couple-invite-tokens';
import {
  appOrigin,
  buildWebsiteInviteHtml,
  loadCoupleSuppressions,
  normalizeEmail,
  publicSiteUrlForSlug,
  resolveCoupleInviteFrom,
} from '@/lib/couple-website-invite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Hard cap per send to prevent abuse (matches the UI's stated limit). */
const MAX_RECIPIENTS = 300;

/** Small delay between sends so we don't hammer Resend (mirrors the venue worker). */
const SEND_THROTTLE_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CoupleProfileLite {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  partner_first_name?: string | null;
  wedding_date?: string | null;
}

function coupleDisplayName(p: CoupleProfileLite | null): string {
  return (
    [p?.first_name, p?.partner_first_name].filter(Boolean).join(' & ').trim() ||
    p?.display_name?.trim() ||
    'The couple'
  );
}

/**
 * GET /api/couple/website-invite
 * Owner-only. Returns everything the compose UI needs: the couple's public site
 * URL (if published), whether it's password protected, the guest emails to
 * prefill (excluding suppressed), the reply-to email, the cap, and last-send info.
 */
export async function GET(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const { user, wedding: link } = gate.ctx;
  const coupleId = link.couple_id as string;

  const [{ data: site }, { data: profile }, { data: guests }, { data: lastSend }, suppressed] =
    await Promise.all([
      supabaseAdmin
        .from('couple_sites')
        .select('slug, is_published, site_password_hash')
        .eq('couple_id', coupleId)
        .maybeSingle(),
      supabaseAdmin
        .from('couple_profiles')
        .select('display_name, first_name, last_name, partner_first_name, wedding_date')
        .eq('id', coupleId)
        .maybeSingle(),
      supabaseAdmin
        .from('wedding_guests')
        .select('full_name, email')
        .eq('couple_wedding_id', link.id),
      supabaseAdmin
        .from('couple_website_invite_sends')
        .select('subject, recipient_count, sent_count, failed_count, created_at')
        .eq('couple_wedding_id', link.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadCoupleSuppressions(link.id),
    ]);

  const s = site as { slug: string | null; is_published: boolean; site_password_hash: string | null } | null;
  const p = profile as CoupleProfileLite | null;
  const published = Boolean(s?.is_published && s?.slug);
  const siteUrl = published ? publicSiteUrlForSlug(s!.slug as string) : null;

  // Prefill guest emails (deduped, valid, not suppressed).
  const seen = new Set<string>();
  const guestRecipients: { name: string; email: string }[] = [];
  for (const g of (guests ?? []) as { full_name: string | null; email: string | null }[]) {
    const email = normalizeEmail(g.email);
    if (!email || seen.has(email) || suppressed.has(email)) continue;
    seen.add(email);
    guestRecipients.push({ name: (g.full_name ?? '').trim(), email });
  }

  return NextResponse.json({
    coupleName: coupleDisplayName(p),
    weddingDate: p?.wedding_date ?? null,
    site: { published, url: siteUrl, hasPassword: Boolean(s?.site_password_hash) },
    replyTo: user.email ?? null,
    maxRecipients: MAX_RECIPIENTS,
    guestRecipients,
    guestsWithoutEmail: ((guests ?? []) as unknown[]).length - guestRecipients.length,
    lastSend: lastSend ?? null,
  });
}

/**
 * POST /api/couple/website-invite
 * Owner-only. Emails the couple's guest list (+ any pasted addresses) an
 * invitation to visit her public wedding website. The website URL and, when
 * provided + verified, the site password are appended automatically.
 */
export async function POST(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const { user, wedding: link } = gate.ctx;
  const coupleId = link.couple_id as string;

  let body: { subject?: unknown; message?: unknown; recipients?: unknown; sitePassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const subject = String(body.subject ?? '').trim().slice(0, 150);
  const message = String(body.message ?? '').trim().slice(0, 5000);
  if (!subject) return NextResponse.json({ error: 'Add a subject line.' }, { status: 400 });
  if (message.length < 2) return NextResponse.json({ error: 'Write a short message to send.' }, { status: 400 });

  const [{ data: site }, { data: profile }, suppressed] = await Promise.all([
    supabaseAdmin
      .from('couple_sites')
      .select('slug, is_published, site_password_hash')
      .eq('couple_id', coupleId)
      .maybeSingle(),
    supabaseAdmin
      .from('couple_profiles')
      .select('display_name, first_name, last_name, partner_first_name, wedding_date')
      .eq('id', coupleId)
      .maybeSingle(),
    loadCoupleSuppressions(link.id),
  ]);

  const s = site as { slug: string | null; is_published: boolean; site_password_hash: string | null } | null;
  const p = profile as CoupleProfileLite | null;
  if (!s?.is_published || !s?.slug) {
    return NextResponse.json(
      { error: 'Publish your wedding website first, then invite your guests.' },
      { status: 400 },
    );
  }
  const siteUrl = publicSiteUrlForSlug(s.slug);
  const coupleName = coupleDisplayName(p);

  // Password: only include it when the site is protected AND the bride supplied
  // the correct password (we store only a scrypt hash, so it can't be recovered).
  let sitePassword: string | null = null;
  if (s.site_password_hash) {
    const provided = typeof body.sitePassword === 'string' ? body.sitePassword.trim() : '';
    if (provided) {
      if (!verifySitePassword(provided, s.site_password_hash)) {
        return NextResponse.json(
          { error: "That doesn't match your website password. Leave it blank to send without it." },
          { status: 400 },
        );
      }
      sitePassword = provided;
    }
  }

  // Recipients come from the client (guest list + pasted extras). Validate,
  // dedupe, drop suppressed, and cap server-side regardless of the UI.
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const seen = new Set<string>();
  const recipients: { name: string; email: string }[] = [];
  let skippedSuppressed = 0;
  for (const r of rawRecipients) {
    const obj = (r ?? {}) as { email?: unknown; name?: unknown };
    const email = normalizeEmail(obj.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    if (suppressed.has(email)) {
      skippedSuppressed += 1;
      continue;
    }
    recipients.push({ name: typeof obj.name === 'string' ? obj.name.trim().slice(0, 120) : '', email });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one valid email address.' }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `You can invite up to ${MAX_RECIPIENTS} guests per send. Remove a few and try again.` },
      { status: 400 },
    );
  }

  const from = resolveCoupleInviteFrom(coupleName);
  const replyTo = user.email ?? undefined;
  const origin = appOrigin();

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    const g = recipients[i];
    const token = signCoupleUnsubscribeToken(link.id, g.email);
    const unsubscribeUrl = `${origin}/api/public/couple-invite/unsubscribe?token=${encodeURIComponent(token)}`;

    const html = buildWebsiteInviteHtml({
      coupleName,
      guestName: g.name || null,
      message,
      siteUrl,
      sitePassword,
      weddingDate: p?.wedding_date ?? null,
      unsubscribeUrl,
    });

    // Couple-scoped List-Id + one-click unsubscribe headers (RFC 2369/8058).
    const headers = buildBulkEmailHeaders(unsubscribeUrl, { mailtoUnsub: replyTo });
    headers['List-Id'] = `<couple-${link.id.replace(/[^a-z0-9-]/gi, '').toLowerCase()}.mail.storyvenue.com>`;

    try {
      const result = await sendEmail({
        to: g.email,
        from,
        replyTo,
        subject,
        html,
        text: htmlToPlainText(html),
        headers,
      });
      if (result.success) sent += 1;
      else failed += 1;
    } catch (err) {
      console.error('[website-invite] send failed', g.email, err);
      failed += 1;
    }

    if (i < recipients.length - 1) await sleep(SEND_THROTTLE_MS);
  }

  await supabaseAdmin.from('couple_website_invite_sends').insert({
    couple_wedding_id: link.id,
    sent_by: user.id,
    subject,
    recipient_count: recipients.length,
    sent_count: sent,
    failed_count: failed,
  });

  return NextResponse.json({ ok: true, sent, failed, skippedSuppressed });
}
