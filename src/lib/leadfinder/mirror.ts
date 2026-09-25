/**
 * StoryVenue LeadFinder™ — the email mirror.
 *
 * LeadFinder reads a venue's inbox on their behalf, which is only trustworthy if
 * the venue can see, in their OWN inbox, that mail arrived and what we did with
 * it. This sends them a faithful copy of every processed arrival — the original
 * subject, sender, received time and full body, unedited — with a short banner on
 * top saying whether a lead was created (and its name and link), whether it is
 * waiting on a human check, or why it was skipped or failed.
 *
 * Three rules shape everything here:
 *
 *   1. It NEVER mirrors twice. The arrival row is claimed with a conditional
 *      UPDATE (`mirrored_at IS NULL`), so a duplicate webhook delivery, a retry,
 *      or two concurrent requests can only ever produce one copy.
 *   2. It is BEST-EFFORT. A mirror failure must never break or roll back lead
 *      creation, so nothing here throws and a failure is recorded on the row as
 *      `mirror_error` rather than retried (a duplicate copy in the owner's inbox
 *      is worse than a missing one).
 *   3. It PRESERVES the original. The subject is unchanged so it threads where
 *      the original would have; the body is the raw text, escaped but never
 *      reflowed or paraphrased.
 */

import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { supabaseAdmin } from '@/lib/supabase';
import { leadFinderReasonLabel } from '@/lib/leadfinder/reasons';

/**
 * Loop protection. Every copy carries this header AND this footer sentence, and
 * ingest refuses any arrival that has either — so a venue that forwards all its
 * mail to LeadFinder cannot bounce a copy back in and start an endless loop.
 * The header survives Gmail forwarding; the sentence survives anything that
 * forwards the body. Change neither without updating `isOwnMessage` in ingest.
 */
export const LEADFINDER_MIRROR_HEADER = 'X-StoryVenue-LeadFinder';
export const LEADFINDER_MIRROR_FOOTER_MARKER =
  'Sent by LeadFinder because a message arrived at your LeadFinder address';

export interface MirrorContext {
  venueId: string;
  importId: string;
  /** venue.notification_email || venue.email. Null when the venue has no email. */
  recipient: string | null;
  /** venue.leadfinder_mirror_enabled — the venue's toggle. */
  enabled: boolean;
  subject: string | null;
  /** The raw From header, e.g. `"Sarah Jones" <sarah@example.com>`. */
  sender: string | null;
  /** The original Reply-To, when the sender set one. */
  originalReplyTo: string | null;
  receivedAt: Date;
  /**
   * The venue's IANA time zone (from its ZIP). Every time in the copy is shown
   * in it, so the venue reads its own local time — never the server's UTC.
   */
  timeZone?: string | null;
  /** Venue branding for the shared email shell: name and brand logo. */
  venueName?: string | null;
  logoUrl?: string | null;
  rawText: string;
}

export type MirrorOutcome =
  | {
      kind: 'lead';
      leadId: string;
      leadName: string;
      /** True when the lead was just created; false when it updated an existing one. */
      created: boolean;
      /** Created but held back from the couple pending a human check. */
      needsReview: boolean;
      /** Why it was held, when it was: `relay_address`, `low_confidence`, … */
      reviewReason?: string | null;
      /** What we read, shown like the standard new-lead email. */
      details?: {
        email: string | null;
        phone: string | null;
        weddingDate: string | null;
        guestCount: number | null;
        /** e.g. "The Knot (via LeadFinder™)". */
        source: string | null;
      };
    }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'gmail_confirmation';
      code: string | null;
      confirmUrl: string | null;
      requestedBy: string | null;
    }
  | {
      /** A test the venue sent from the LeadFinder card: read, never a lead. */
      kind: 'test';
      wouldCreateLead: boolean;
      reason: string | null;
      read: {
        name: string | null;
        email: string | null;
        phone: string | null;
        weddingDate: string | null;
        guestCount: number | null;
      };
    };

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Bare address out of `"Name" <email@host>` or `email@host`, for Reply-To. */
function senderEmail(raw: string | null): string | null {
  if (!raw) return null;
  const inBrackets = /<([^>]+)>/.exec(raw);
  const candidate = (inBrackets ? inBrackets[1] : raw).trim();
  return /@/.test(candidate) ? candidate : null;
}

function humanizeReason(reason: string | null | undefined): string {
  return leadFinderReasonLabel(reason) ?? 'no reason recorded';
}

function formatReceived(at: Date, timeZone?: string): string {
  try {
    return at.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    });
  } catch {
    return at.toISOString();
  }
}

interface Banner {
  tone: 'ok' | 'review' | 'warn';
  headline: string;
  detail: string;
  ctaUrl: string | null;
  ctaLabel: string | null;
}

function buildBanner(outcome: MirrorOutcome): Banner {
  if (outcome.kind === 'test') {
    const r = outcome.read;
    const readBits = [
      r.name && `name ${r.name}`,
      r.email && `email ${r.email}`,
      r.phone && `phone ${r.phone}`,
      r.weddingDate && `wedding date ${r.weddingDate}`,
      r.guestCount !== null && `${r.guestCount} guests`,
    ].filter(Boolean);
    return {
      tone: 'ok',
      headline: 'Test received — your LeadFinder address is working',
      detail:
        'This is the test you sent from Settings → Integrations. ' +
        (readBits.length ? `We read: ${readBits.join(', ')}. ` : '') +
        (outcome.wouldCreateLead
          ? 'A real inquiry like this would have become a lead. Because it was a test, nothing was added to your leads and nobody was emailed.'
          : `A real inquiry like this would NOT have become a lead: ${humanizeReason(outcome.reason)}. Nothing was added to your leads.`),
      ctaUrl: `${APP_URL}/dashboard/settings/integrations`,
      ctaLabel: 'Open LeadFinder',
    };
  }

  if (outcome.kind === 'gmail_confirmation') {
    const who = outcome.requestedBy ? ` for ${outcome.requestedBy}` : '';
    return {
      tone: 'review',
      headline: outcome.code
        ? `Your Gmail forwarding code is ${outcome.code}`
        : 'Gmail is asking you to confirm forwarding',
      detail:
        `Gmail sent this to your LeadFinder address to confirm forwarding${who}. ` +
        (outcome.code
          ? `In Gmail, open Settings → Forwarding and POP/IMAP, click "Verify" next to your LeadFinder address and enter ${outcome.code} — or use Gmail's own confirmation link below. `
          : 'Use Gmail\'s own confirmation link below. ') +
        'Then add the filter that forwards your directory emails. This message is not a lead.',
      ctaUrl: outcome.confirmUrl,
      ctaLabel: outcome.confirmUrl ? 'Confirm in Gmail' : null,
    };
  }

  if (outcome.kind === 'lead') {
    const leadUrl = `${APP_URL}/dashboard/contacts/lead/${outcome.leadId}`;
    if (outcome.created && outcome.needsReview && outcome.reviewReason === 'relay_address') {
      return {
        tone: 'review',
        headline: `Lead created — ${outcome.leadName} — reply through the marketplace`,
        detail:
          'We saved this as a lead and alerted you, but the only address in this message is the marketplace\'s ' +
          'relay (replies go through their inbox, not straight to the couple), so we did NOT send your guide automatically. ' +
          'Reply on the marketplace, or confirm the lead to send the guide through the relay.',
        ctaUrl: `${APP_URL}/dashboard/settings/integrations/leadfinder-review`,
        ctaLabel: 'Review this arrival',
      };
    }
    if (outcome.created && outcome.needsReview) {
      return {
        tone: 'review',
        headline: `Lead created — ${outcome.leadName} — but it needs a quick check`,
        detail:
          'We saved this as a lead and alerted you, but we did NOT email the couple yet. ' +
          'What we could read was below the confidence we need to auto-reply, so a person should confirm the details first.',
        ctaUrl: `${APP_URL}/dashboard/settings/integrations/leadfinder-review`,
        ctaLabel: 'Review this arrival',
      };
    }
    if (outcome.created) {
      return {
        tone: 'ok',
        headline: `New lead: ${outcome.leadName}`,
        detail: 'A new inquiry came in through LeadFinder™. We saved it as a lead and started your normal follow-up.',
        ctaUrl: leadUrl,
        ctaLabel: 'View Lead',
      };
    }
    return {
      tone: 'ok',
      headline: `Lead updated: ${outcome.leadName}`,
      detail:
        'This message matched a lead you already have, so we added anything new we found instead of creating a duplicate. No follow-up was sent again.',
      ctaUrl: leadUrl,
      ctaLabel: 'View Lead',
    };
  }

  if (outcome.kind === 'skipped') {
    return {
      tone: 'warn',
      headline: 'Not turned into a lead',
      detail: `We kept this message in your LeadFinder record but did not create a lead: ${humanizeReason(outcome.reason)}.`,
      ctaUrl: null,
      ctaLabel: null,
    };
  }

  return {
    tone: 'warn',
    headline: 'We could not finish with this message',
    detail: `Something went wrong while processing this message: ${humanizeReason(outcome.reason)}. It is kept in your LeadFinder record so nothing is lost.`,
    ctaUrl: null,
    ctaLabel: null,
  };
}

/** A small status label above the explanation, in the tone of the outcome. */
const TONE_LABEL: Record<Banner['tone'], { text: string; color: string }> = {
  ok: { text: 'LeadFinder™', color: '#047857' },
  review: { text: 'LeadFinder™ · needs a quick check', color: '#b45309' },
  warn: { text: 'LeadFinder™', color: '#6b7280' },
};

/**
 * The inbox copy, rendered in the same branded shell as every other owner
 * email (buildSystemEmail: the venue's logo and accent color, centered heading,
 * "Sent via StoryVenue on behalf of …" footer), so it reads as one more
 * StoryVenue notification rather than a one-off design.
 *
 * Everything that comes from the email — the lead's name in the headline, the
 * sender, subject and body — is escaped here: the shell inserts heading, title
 * and preheader as raw HTML.
 */
function buildMirrorHtml(ctx: MirrorContext, outcome: MirrorOutcome): string {
  const banner = buildBanner(outcome);
  const tone = TONE_LABEL[banner.tone];
  const subject = ctx.subject?.trim() || '(no subject)';
  const received = formatReceived(ctx.receivedAt, ctx.timeZone ?? undefined);
  const venueName = ctx.venueName?.trim() || 'your venue';

  const row = (label: string, value: string) =>
    `<tr><td style="padding:3px 12px 3px 0;color:#9ca3af;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>` +
    `<td style="padding:3px 0;color:#374151;font-size:13px;word-break:break-word;">${escapeHtml(value)}</td></tr>`;

  // For a lead, the key facts. Ingest only sends this copy for an UPDATED lead:
  // a created lead gets the standard new-lead email instead (one email per lead).
  let leadHtml = '';
  if (outcome.kind === 'lead') {
    const d = outcome.details;
    const line = (label: string, value: string | null | undefined) =>
      `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">${label}: ${escapeHtml(value && String(value).trim() ? String(value) : '—')}</p>`;
    leadHtml = [
      line('Name', outcome.leadName),
      line('Phone', d?.phone),
      line('Email', d?.email),
      d?.weddingDate ? line('Wedding date', d.weddingDate) : '',
      d?.guestCount != null ? line('Guests', String(d.guestCount)) : '',
      line('Source', d?.source ?? 'LeadFinder™'),
      line('Created', received),
      '<div style="height:18px"></div>',
    ].join('');
  }

  const bodyHtml = `
    ${banner.tone === 'review' ? `<p style="margin:0 0 10px;font-size:13px;font-weight:600;color:${tone.color};">Needs a quick check before the couple is contacted.</p>` : ''}
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">${escapeHtml(banner.detail)}</p>
    ${leadHtml}
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">The original message</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 10px;">
      ${row('From', ctx.sender || '(unknown sender)')}
      ${row('Subject', subject)}
      ${row('Received', received)}
    </table>
    <div style="padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;line-height:1.6;color:#374151;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(ctx.rawText)}</div>`;

  const headline = escapeHtml(banner.headline);
  return buildSystemEmail({
    // No logoUrl: always the StoryVenue dark logo, centered, like every email.
    logoAlt: 'StoryVenue',
    // One brand color across every email in the product.
    accentColor: '#1b1b1b',
    preheader: headline,
    title: headline,
    heading: headline,
    bodyHtml,
    cta: banner.ctaUrl && banner.ctaLabel ? { label: escapeHtml(banner.ctaLabel), url: banner.ctaUrl } : undefined,
    showLinkFallback: !!banner.ctaUrl,
    // The first sentence is the loop-guard marker ingest looks for — keep it verbatim.
    footerHtml:
      `<p style="margin:0 0 8px;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">${LEADFINDER_MIRROR_FOOTER_MARKER}. Turn this copy off in Settings → Integrations.</p>` +
      `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">Sent via StoryVenue on behalf of ${escapeHtml(venueName)}</p>`,
  });
}

/** A StoryVenue-style subject, like the other owner notifications. */
function mirrorSubject(ctx: MirrorContext, outcome: MirrorOutcome): string {
  const venue = ctx.venueName?.trim() || 'your venue';
  const original = ctx.subject?.trim() || '(no subject)';
  switch (outcome.kind) {
    case 'lead':
      if (!outcome.created) return `Lead updated: ${outcome.leadName} — ${venue}`;
      return outcome.needsReview
        ? `New lead (needs a quick check): ${outcome.leadName} — ${venue}`
        : `New lead: ${outcome.leadName} — ${venue}`;
    case 'gmail_confirmation':
      return outcome.code ? `Your Gmail forwarding code: ${outcome.code}` : 'Confirm Gmail forwarding for LeadFinder';
    case 'test':
      return `LeadFinder test received — ${venue}`;
    default:
      return `LeadFinder: ${original}`;
  }
}

function buildMirrorText(ctx: MirrorContext, outcome: MirrorOutcome): string {
  const banner = buildBanner(outcome);
  const subject = ctx.subject?.trim() || '(no subject)';
  return [
    `LEADFINDER — ${banner.headline}`,
    banner.detail,
    banner.ctaUrl ? `${banner.ctaLabel}: ${banner.ctaUrl}` : '',
    '',
    '--- The original message ---',
    `From: ${ctx.sender || '(unknown sender)'}`,
    `Subject: ${subject}`,
    `Received: ${formatReceived(ctx.receivedAt, ctx.timeZone ?? undefined)}`,
    '',
    ctx.rawText,
    '',
    `${LEADFINDER_MIRROR_FOOTER_MARKER}. Turn this copy off in Settings → Integrations.`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Send the venue their copy of an arrival. Idempotent and best-effort: claims the
 * arrival atomically, never throws, and records any send failure on the row.
 */
export async function mirrorArrivalToVenue(
  ctx: MirrorContext,
  outcome: MirrorOutcome,
): Promise<void> {
  try {
    // Respect the venue toggle, and a venue with no email has nowhere to send.
    if (!ctx.enabled) return;
    const to = ctx.recipient?.trim();
    if (!to) return;

    // Atomic claim. Setting mirrored_at in the same statement that requires it to
    // be NULL is what makes this exactly-once: only one caller gets a row back.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('leadfinder_imports')
      .update({ mirrored_at: new Date().toISOString() })
      .eq('id', ctx.importId)
      .eq('venue_id', ctx.venueId)
      .is('mirrored_at', null)
      .select('id')
      .maybeSingle();

    if (claimErr) {
      console.warn('[leadfinder mirror] claim failed:', claimErr.message);
      return;
    }
    if (!claimed) return; // already mirrored (or the row is gone) — never send twice.

    // Reply-To: preserve the original routing so a reply from the owner reaches
    // the same place the original would have (the couple or the marketplace),
    // then fall back to our monitored reply address, then the venue's own email
    // — never leave it unset, so a reply can't bounce off our send-only mailbox.
    const replyTo =
      ctx.originalReplyTo?.trim() ||
      senderEmail(ctx.sender) ||
      process.env.NOTIFICATION_REPLY_TO?.trim() ||
      undefined;

    const notifFromEmail =
      process.env.NOTIFICATION_FROM_EMAIL?.trim() || 'notifications@send.storyvenue.com';

    const result = await sendEmail({
      to,
      subject: mirrorSubject(ctx, outcome),
      html: buildMirrorHtml(ctx, outcome),
      text: buildMirrorText(ctx, outcome),
      replyTo,
      // Same sender name as every other owner notification.
      from: { email: notifFromEmail, name: 'StoryVenue' },
      headers: {
        [LEADFINDER_MIRROR_HEADER]: `mirror; import=${ctx.importId}`,
        // RFC 3834: tells auto-responders not to answer a machine-sent copy.
        'Auto-Submitted': 'auto-generated',
      },
    });

    if (!result.success) {
      await supabaseAdmin
        .from('leadfinder_imports')
        .update({ mirror_error: result.error ?? 'send_failed' })
        .eq('id', ctx.importId);
    }
  } catch (e) {
    // Best-effort: a mirror problem must never surface to the ingest caller.
    console.warn('[leadfinder mirror] threw:', e);
    try {
      await supabaseAdmin
        .from('leadfinder_imports')
        .update({ mirror_error: e instanceof Error ? e.message : 'mirror_threw' })
        .eq('id', ctx.importId);
    } catch {
      /* nothing more we can do */
    }
  }
}
