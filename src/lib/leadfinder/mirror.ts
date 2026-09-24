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
import { supabaseAdmin } from '@/lib/supabase';

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
    }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

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

/**
 * Turn an internal machine reason into a sentence a venue owner understands.
 * Unknown reasons degrade to the raw token with underscores removed rather than
 * being hidden, so a new skip reason is still legible.
 */
const REASON_LABELS: Record<string, string> = {
  not_an_inquiry_subject: 'it looked like an account notification, not an inquiry',
  no_email_address: 'we could not find an email address to reply to',
  leadfinder_disabled_for_venue: 'LeadFinder is not switched on for your account',
  extract_threw: 'we could not read the message',
  lead_insert_failed: 'we could not save the lead',
  import_row_failed: 'we could not record the message',
  rejected: 'it did not look like a wedding inquiry',
};

function humanizeReason(reason: string | null | undefined): string {
  if (!reason) return 'no reason recorded';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
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
  if (outcome.kind === 'lead') {
    const leadUrl = `${APP_URL}/dashboard/contacts/${outcome.leadId}`;
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
        headline: `Lead created — ${outcome.leadName}`,
        detail: 'We saved this as a new lead and started your normal follow-up.',
        ctaUrl: leadUrl,
        ctaLabel: 'View the lead',
      };
    }
    return {
      tone: 'ok',
      headline: `Existing lead updated — ${outcome.leadName}`,
      detail:
        'This message matched a lead you already have, so we added anything new we found instead of creating a duplicate. No follow-up was sent again.',
      ctaUrl: leadUrl,
      ctaLabel: 'View the lead',
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

const TONE_STYLES: Record<Banner['tone'], { border: string; bg: string; label: string; labelColor: string }> = {
  ok: { border: '#a7f3d0', bg: '#ecfdf5', label: 'LeadFinder', labelColor: '#047857' },
  review: { border: '#fde68a', bg: '#fffbeb', label: 'LeadFinder — needs review', labelColor: '#b45309' },
  warn: { border: '#e5e7eb', bg: '#f9fafb', label: 'LeadFinder', labelColor: '#4b5563' },
};

function buildMirrorHtml(ctx: MirrorContext, outcome: MirrorOutcome): string {
  const banner = buildBanner(outcome);
  const tone = TONE_STYLES[banner.tone];
  const subject = ctx.subject?.trim() || '(no subject)';
  const received = formatReceived(ctx.receivedAt);

  const cta = banner.ctaUrl && banner.ctaLabel
    ? `<div style="margin-top:14px"><a href="${escapeHtml(banner.ctaUrl)}" style="display:inline-block;background:#1b1b1b;color:#ffffff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(banner.ctaLabel)}</a></div>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b;">
    <div style="background:#ffffff;border:1px solid ${tone.border};border-radius:14px;overflow:hidden;">
      <div style="background:${tone.bg};padding:16px 20px;border-bottom:1px solid ${tone.border};">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tone.labelColor};">${tone.label}</div>
        <div style="font-size:16px;font-weight:600;margin-top:4px;">${escapeHtml(banner.headline)}</div>
        <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-top:6px;">${escapeHtml(banner.detail)}</div>
        ${cta}
      </div>

      <div style="padding:16px 20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">The original message</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;color:#4b5563;margin-top:8px;">
          <tr><td style="padding:2px 8px 2px 0;white-space:nowrap;color:#9ca3af;">From</td><td style="padding:2px 0;word-break:break-word;">${escapeHtml(ctx.sender || '(unknown sender)')}</td></tr>
          <tr><td style="padding:2px 8px 2px 0;white-space:nowrap;color:#9ca3af;">Subject</td><td style="padding:2px 0;word-break:break-word;">${escapeHtml(subject)}</td></tr>
          <tr><td style="padding:2px 8px 2px 0;white-space:nowrap;color:#9ca3af;">Received</td><td style="padding:2px 0;word-break:break-word;">${escapeHtml(received)}</td></tr>
        </table>

        <pre style="margin:14px 0 0;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.55;color:#374151;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(ctx.rawText)}</pre>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:#9ca3af;margin-top:14px;">
      Sent by LeadFinder because a message arrived at your LeadFinder address. Turn this copy off in Settings → Integrations.
    </div>
  </div>
</body></html>`;
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
    `Received: ${formatReceived(ctx.receivedAt)}`,
    '',
    ctx.rawText,
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
      // Keep the original subject so it threads where the original would have.
      subject: ctx.subject?.trim() || '(no subject)',
      html: buildMirrorHtml(ctx, outcome),
      text: buildMirrorText(ctx, outcome),
      replyTo,
      from: { email: notifFromEmail, name: 'StoryVenue LeadFinder' },
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
