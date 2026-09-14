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
  neutralizeLinks,
  normalizeEmail,
  publicSiteUrlForSlug,
  resolveCoupleInviteFrom,
} from '@/lib/couple-website-invite';
import { notifyCoupleInviteAlert } from '@/lib/slack-notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Hard cap per send to prevent abuse (matches the UI's stated limit). */
const MAX_RECIPIENTS = 300;

// ── Rolling-24h abuse guardrails (tunable) ─────────────────────────────────
/** Max distinct sends a couple can trigger per rolling 24h. */
const MAX_SENDS_PER_DAY = 3;
/** Max total recipients a couple can email per rolling 24h (sum of sends). */
const MAX_RECIPIENTS_PER_DAY = 500;
/** Minimum gap between two sends, based on the most recent send's created_at. */
const SEND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
/** A single send above this many recipients fires a Slack heads-up. */
const LARGE_SEND_ALERT_THRESHOLD = 200;

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
        .select('full_name, email, phone')
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
  const guestRecipients: { name: string; email: string; phone: string }[] = [];
  for (const g of (guests ?? []) as { full_name: string | null; email: string | null; phone: string | null }[]) {
    const email = normalizeEmail(g.email);
    if (!email || seen.has(email) || suppressed.has(email)) continue;
    seen.add(email);
    guestRecipients.push({ name: (g.full_name ?? '').trim(), email, phone: (g.phone ?? '').trim() });
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

  // Admin / auto kill-switch. Tolerant reader: default false when the column is
  // absent on an older deploy.
  if (link.invite_sending_paused === true) {
    return NextResponse.json(
      {
        error:
          'Guest invites are temporarily paused on your account. Please contact support and we’ll get you sending again.',
      },
      { status: 403 },
    );
  }

  let body: { subject?: unknown; message?: unknown; recipients?: unknown; sitePassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Neutralize any pasted URLs in the subject/message so the only clickable link
  // is the auto-added website button (see neutralizeLinks). Slice again after in
  // case a placeholder swap nudged the length.
  const subject = neutralizeLinks(String(body.subject ?? '').trim().slice(0, 150)).slice(0, 150);
  const message = neutralizeLinks(String(body.message ?? '').trim().slice(0, 5000)).slice(0, 5000);
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
  const recipients: { name: string; email: string; phone: string }[] = [];
  let skippedSuppressed = 0;
  let skippedNoName = 0;
  for (const r of rawRecipients) {
    const obj = (r ?? {}) as { email?: unknown; name?: unknown; phone?: unknown };
    const email = normalizeEmail(obj.email);
    if (!email || seen.has(email)) continue;
    // Name is required — we collect complete records only. Anything nameless is
    // dropped defensively (the UI already enforces this).
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 120) : '';
    if (!name) {
      skippedNoName += 1;
      continue;
    }
    seen.add(email);
    if (suppressed.has(email)) {
      skippedSuppressed += 1;
      continue;
    }
    const phone = typeof obj.phone === 'string' ? obj.phone.trim().slice(0, 40) : '';
    recipients.push({ name, email, phone });
  }

  if (recipients.length === 0) {
    return NextResponse.json(
      {
        error:
          skippedNoName > 0
            ? 'Every recipient needs a name and an email. Add a name for each guest and try again.'
            : 'Add at least one recipient with a name and email.',
      },
      { status: 400 },
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `You can invite up to ${MAX_RECIPIENTS} guests per send. Remove a few and try again.` },
      { status: 400 },
    );
  }

  // ── Rolling-24h rate limiting ────────────────────────────────────────────
  // Query this wedding's recent send log and enforce the cooldown + daily caps.
  // We return 429 (and DO NOT log a send row) on any breach.
  {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSends } = await supabaseAdmin
      .from('couple_website_invite_sends')
      .select('recipient_count, created_at')
      .eq('couple_wedding_id', link.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    const rows = (recentSends ?? []) as { recipient_count: number | null; created_at: string }[];
    const sendsToday = rows.length;
    const recipientsToday = rows.reduce((sum, r) => sum + (r.recipient_count ?? 0), 0);
    const lastAt = rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0;

    if (lastAt) {
      const elapsed = Date.now() - lastAt;
      if (elapsed < SEND_COOLDOWN_MS) {
        const waitMin = Math.max(1, Math.ceil((SEND_COOLDOWN_MS - elapsed) / 60000));
        return NextResponse.json(
          { error: `You just sent invites — please wait about ${waitMin} more minute${waitMin === 1 ? '' : 's'} before sending again.` },
          { status: 429 },
        );
      }
    }
    if (sendsToday >= MAX_SENDS_PER_DAY) {
      return NextResponse.json(
        { error: `You’ve reached the limit of ${MAX_SENDS_PER_DAY} sends in 24 hours. Please try again tomorrow.` },
        { status: 429 },
      );
    }
    if (recipientsToday + recipients.length > MAX_RECIPIENTS_PER_DAY) {
      const remaining = Math.max(0, MAX_RECIPIENTS_PER_DAY - recipientsToday);
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `You can email up to ${MAX_RECIPIENTS_PER_DAY} guests per 24 hours. You have ${remaining} left today — remove ${recipients.length - remaining} recipient${recipients.length - remaining === 1 ? '' : 's'} and try again.`
              : `You’ve reached the limit of ${MAX_RECIPIENTS_PER_DAY} guests emailed in 24 hours. Please try again tomorrow.`,
        },
        { status: 429 },
      );
    }
  }

  // Heads-up to support on an unusually large single send (fire before sending
  // so we still learn about it even if the loop errors mid-way).
  if (recipients.length > LARGE_SEND_ALERT_THRESHOLD) {
    await notifyCoupleInviteAlert({
      kind: 'large_send',
      coupleWeddingId: link.id,
      coupleName,
      venueId: link.venue_id,
      detail: `${recipients.length} recipients in a single send (subject: "${subject.slice(0, 80)}").`,
    });
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
    // Correlation headers so the Resend webhook can map bounce/complaint events
    // back to this wedding (couple side, distinct from venue X-Venue-Id/X-Lead-Id).
    headers['X-Couple-Wedding-Id'] = link.id;
    headers['X-Couple-Invite'] = '1';

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

  // Auto-add every recipient to the couple's Guest list so she can track who's
  // been invited and who hasn't responded. Existing guests (matched by
  // case-insensitive email) get their first `invited_at` stamped; brand-new
  // addresses (pasted/CSV) are inserted as "Invited · Awaiting response"
  // (rsvp_status 'pending') and flip to Attending/Declined when they RSVP on
  // the website. This is pure bookkeeping — it runs after the send and never
  // fails the request, so a hiccup here can't block a successful send.
  try {
    await syncInvitedGuests(link, recipients);
  } catch (err) {
    console.error('[website-invite] guest auto-add failed', err);
  }

  return NextResponse.json({ ok: true, sent, failed, skippedSuppressed });
}

interface WeddingLinkLite {
  id: string;
  couple_id: string | null;
  venue_id: string;
  venue_customer_id?: string | null;
}

/**
 * Upsert website-invite recipients into `wedding_guests` for this wedding.
 * - Existing guest (case-insensitive email): stamp `invited_at = now()` only if
 *   it's still null (preserve the first-invited time). Nothing else is touched.
 * - New email: insert a guest with the recipient's name (or a clean fallback),
 *   `rsvp_status = 'pending'`, `party_size = 1`, `invited_at = now()`, and
 *   `invite_source = 'website_invite'`.
 * Fetches existing emails once, then batches the update + insert. Duplicates are
 * impossible because we match on the normalized (lowercased) email.
 */
async function syncInvitedGuests(
  link: WeddingLinkLite,
  recipients: { name: string; email: string; phone: string }[],
): Promise<void> {
  if (recipients.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from('wedding_guests')
    .select('id, email, invited_at, phone')
    .eq('couple_wedding_id', link.id);

  // Map normalized email → { id, alreadyInvited, hasPhone } for O(1) matching.
  const byEmail = new Map<string, { id: string; alreadyInvited: boolean; hasPhone: boolean }>();
  for (const row of (existing ?? []) as {
    id: string;
    email: string | null;
    invited_at: string | null;
    phone: string | null;
  }[]) {
    const key = normalizeEmail(row.email);
    if (key && !byEmail.has(key)) {
      byEmail.set(key, {
        id: row.id,
        alreadyInvited: Boolean(row.invited_at),
        hasPhone: Boolean((row.phone ?? '').trim()),
      });
    }
  }

  const now = new Date().toISOString();
  const idsToStamp: string[] = [];
  // Existing guests missing a phone we can now backfill (per-guest, so batched
  // individually — usually a small handful).
  const phoneBackfills: { id: string; phone: string }[] = [];
  const toInsert: Record<string, unknown>[] = [];

  for (const r of recipients) {
    // recipients are already normalized+deduped upstream, but normalize again to
    // match how existing guest emails are keyed.
    const email = normalizeEmail(r.email);
    if (!email) continue;
    const phone = (r.phone ?? '').trim().slice(0, 40);
    const match = byEmail.get(email);
    if (match) {
      if (!match.alreadyInvited) idsToStamp.push(match.id);
      // Own the data: backfill a phone number when we have one and the guest
      // record doesn't (never overwrite an existing phone).
      if (phone && !match.hasPhone && match.id) {
        phoneBackfills.push({ id: match.id, phone });
        match.hasPhone = true;
      }
    } else {
      toInsert.push({
        couple_wedding_id: link.id,
        couple_id: link.couple_id,
        venue_id: link.venue_id,
        venue_customer_id: link.venue_customer_id ?? null,
        full_name: guestNameFromRecipient(r.name, email),
        email,
        phone: phone || null,
        party_size: 1,
        rsvp_status: 'pending',
        invited_at: now,
        invite_source: 'website_invite',
      });
      // Guard against duplicate inserts if the same new email appears twice.
      byEmail.set(email, { id: '', alreadyInvited: true, hasPhone: Boolean(phone) });
    }
  }

  if (idsToStamp.length > 0) {
    await supabaseAdmin.from('wedding_guests').update({ invited_at: now }).in('id', idsToStamp);
  }
  for (const b of phoneBackfills) {
    await supabaseAdmin.from('wedding_guests').update({ phone: b.phone }).eq('id', b.id);
  }
  if (toInsert.length > 0) {
    await supabaseAdmin.from('wedding_guests').insert(toInsert);
  }
}

/**
 * `full_name` is NOT NULL, so a pasted/CSV recipient with no name still needs a
 * sensible display name. Use the provided name when present; otherwise derive a
 * clean "First Last" from the email local-part only when it reads cleanly
 * (letters + separators, no digits), else fall back to the email address itself.
 * We never fabricate an ugly name like "jsmith123".
 */
function guestNameFromRecipient(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed.slice(0, 120);

  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const readsCleanly = parts.length > 0 && parts.every((p) => /^[a-z]+$/i.test(p));
  if (readsCleanly) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ').slice(0, 120);
  }
  return email.slice(0, 120);
}
