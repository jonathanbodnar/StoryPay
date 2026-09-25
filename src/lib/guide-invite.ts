/**
 * The gated "Send me my guide" invite — how a directory lead joins the SMS side
 * of the Bride Booking System.
 *
 * A couple captured by LeadFinder asked a directory for info; their number came
 * from the directory, so it is not consent to text them. Instead of emailing the
 * guide straight away, we email ONE button ("Send me my guide"). The page it
 * opens asks for their mobile + email and one tap sends the guide by text and
 * email — that tap, under the consent line, is their opt-in. From there they get
 * exactly what a listing-form lead gets: Phase 1 guide delivery, the Phase 2
 * 14-day sequence, and AI outreach after day 14 when the venue has it on.
 *
 * Couples who don't tap: after 1 hour the guide goes by
 * email and Phase 2 starts anyway — its SMS steps skip without consent. Nobody
 * is dropped. A venue that can't text at all never gets the gate: today's
 * email-guide behaviour applies.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { getGhlToken } from '@/lib/ghl';
import { loadVenueFeatureAccess } from '@/lib/plan-features';
import {
  resolveBookingSystemEntitlement,
  VENUE_ENTITLEMENT_COLUMNS,
  type VenueBillingState,
} from '@/lib/venue-entitlements';
import {
  buildGuideShortUrl,
  buildMergeVars,
  findOrCreateChannelThreadForLead,
  logNewLeadOpportunity,
  logToConversationThread,
  onMarketingFormSubmitted,
  resolveVenueFromAddress,
  sendBookingSystemGuide,
} from '@/lib/marketing-email-worker';
import { ensureListingForm } from '@/lib/listing-lead-form';
import { grantSmsConsentForLeadIds, recordSmsConsentEvidence } from '@/lib/sms-consent';
import { guidePageConsentText, SMS_CONSENT_VERSION, withPolicyLinks } from '@/lib/sms-consent-disclosure';
import { normalizePhone } from '@/lib/leadfinder/extract';
import { syncLeadAnswersToContact } from '@/lib/leadfinder/contact-sync';
import { signGuideInviteToken, verifyGuideInviteToken } from '@/lib/guide-invite-token';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

/** No tap by now: email the guide and start the sequence without SMS. */
const FALLBACK_AFTER_MS = 60 * 60 * 1000;
/** Cap per cron run, so a backlog can never stall the marketing cron. */
const CRON_BATCH = 40;

export function guideInviteUrl(token: string): string {
  return `${APP_URL}/get-guide/${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Can this venue text an opted-in couple at all? ──────────────────────────

/**
 * Gating only makes sense when tapping would actually start texts: the Booking
 * System is entitled and on, the venue sends the guide by email AND text, its
 * plan includes SMS, and a sending account is connected. Mirrors the checks in
 * sendBookingSystemGuide and sendAutomationSmsToLead.
 */
export async function venueCanTextLeads(venueId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('venues')
      .select(`booking_system_enabled, booking_guide_email_enabled, booking_guide_sms_enabled, ghl_access_token, ghl_location_id, ghl_connected, ${VENUE_ENTITLEMENT_COLUMNS}`)
      .eq('id', venueId)
      .maybeSingle();
    const v = data as Record<string, unknown> | null;
    if (!v) return false;
    if (!(await resolveBookingSystemEntitlement(v as unknown as VenueBillingState))) return false;
    if (((v.booking_system_enabled as boolean | null) ?? true) === false) return false;
    if (((v.booking_guide_email_enabled as boolean | null) ?? true) === false) return false;
    if (((v.booking_guide_sms_enabled as boolean | null) ?? true) === false) return false;
    if (!(await loadVenueFeatureAccess(venueId)).hasSms) return false;
    const hasAgencyKey = !!(process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY);
    if (!hasAgencyKey && v.ghl_connected !== true) return false;
    return !!getGhlToken(v as { ghl_access_token?: string | null }) && !!v.ghl_location_id;
  } catch (e) {
    console.warn('[guide-invite] capability check failed — keeping the email guide:', e);
    return false;
  }
}

// ── The invite email ─────────────────────────────────────────────────────────

async function sendInviteEmail(venueId: string, leadId: string): Promise<boolean> {
  const token = signGuideInviteToken(leadId, venueId);
  if (!token) return false;

  // Same gate as the guide email: null when the lead has no email or has
  // unsubscribed / bounced, in which case nothing is sent.
  const vars = await buildMergeVars(venueId, leadId, APP_URL, { forSms: false });
  if (!vars?.email) return false;

  const { data: leadRow } = await supabaseAdmin.from('leads').select('referral_source').eq('id', leadId).maybeSingle();
  const via = ((leadRow as { referral_source?: string | null } | null)?.referral_source ?? '').trim();

  const venueName = vars.venue_name || 'our venue';
  const first = (vars.first_name || '').trim();
  const link = guideInviteUrl(token);

  const subject = `${first ? `${first}, your` : 'Your'} ${venueName} pricing guide is ready`;
  const lead = `Thanks for reaching out to ${venueName}${via ? ` through ${via}` : ''}! Your pricing & planning guide is ready.`;

  // The same shared shell as every other email the product sends: the venue's
  // StoryVenue dark logo centered at the top (always), #1b1b1b button,
  // "Sent via StoryVenue on behalf of …" footer.
  const heading = 'Your pricing guide is ready';
  const p = (text: string) => `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px;">${escapeHtml(text)}</p>`;
  const html = buildSystemEmail({
    // No logoUrl: the shell renders the StoryVenue dark logo — always.
    logoAlt: 'StoryVenue',
    accentColor: '#1b1b1b',
    preheader: escapeHtml(lead),
    title: escapeHtml(heading),
    heading: escapeHtml(heading),
    bodyHtml: [p(`Hi${first ? ` ${first}` : ''},`), p(lead), p(`– ${venueName}`)].join('\n'),
    cta: { label: 'Send me my guide', url: link },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">Sent via StoryVenue on behalf of ${escapeHtml(venueName)}</p>`,
  });
  const text = [`Hi${first ? ` ${first}` : ''},`, '', lead, '', `Send me my guide: ${link}`, '', `– ${venueName}`].join('\n');

  // Same sender and reply routing as the guide email: from the venue, and a
  // reply lands in the venue's Conversations thread for this couple.
  const thread = await findOrCreateChannelThreadForLead(venueId, leadId, 'email');
  const { buildConversationsReplyToEmail } = await import('@/lib/conversations-inbound-email');
  const { fromName, fromEmail, replyTo: venueReplyTo } = await resolveVenueFromAddress(venueId);
  const replyTo = (thread ? buildConversationsReplyToEmail(thread.threadId, venueId) : null) ?? venueReplyTo;

  const sent = await sendEmail({ to: vars.email, from: { name: fromName, email: fromEmail }, replyTo, subject, html, text });
  if (!sent.success) {
    console.warn('[guide-invite] email failed:', sent.error, { venueId, leadId });
    return false;
  }
  if (thread) {
    await logToConversationThread({
      threadId: thread.threadId,
      venueId,
      channel: 'email',
      body: '📧 Guide invite sent — waiting for them to tap "Send me my guide" (text + email).',
    }).catch(() => {});
  }
  return true;
}

async function markThread(venueId: string, leadId: string, body: string): Promise<void> {
  try {
    const thread = await findOrCreateChannelThreadForLead(venueId, leadId, 'email');
    if (thread) await logToConversationThread({ threadId: thread.threadId, venueId, channel: 'email', body });
  } catch {
    /* a marker is a nicety */
  }
}

/** Phase 2 — the same workflow trigger a listing-form submission fires. */
async function startPhase2(venueId: string, leadId: string): Promise<void> {
  try {
    const formId = await ensureListingForm(venueId);
    if (formId) await onMarketingFormSubmitted(venueId, leadId, formId);
    else console.warn('[guide-invite] no listing form — Phase 2 not started', { venueId, leadId });
  } catch (e) {
    console.error('[guide-invite] Phase 2 enrollment failed:', e);
  }
}

// ── At capture ───────────────────────────────────────────────────────────────

/**
 * Start the gated invite for a lead captured without SMS consent. Returns false
 * when the caller should keep today's behaviour (guide by email + Phase 2):
 * the venue can't text, no token secret is configured, migration 259 isn't
 * applied, or the email couldn't be sent.
 */
export async function startGuideInvite(venueId: string, leadId: string): Promise<boolean> {
  if (!(await venueCanTextLeads(venueId))) return false;
  if (!signGuideInviteToken(leadId, venueId)) return false;

  const { error } = await supabaseAdmin.from('guide_invites').insert({ venue_id: venueId, lead_id: leadId });
  if (error) {
    // Already invited (a review confirm after capture, say): nothing more to do.
    if (error.code === '23505') return true;
    console.warn('[guide-invite] could not record the invite — keeping the email guide:', error.message);
    return false;
  }

  if (await sendInviteEmail(venueId, leadId)) return true;

  // Couldn't send it: undo, so the caller emails the guide instead.
  await supabaseAdmin.from('guide_invites').delete().eq('lead_id', leadId);
  return false;
}

// ── On tap ───────────────────────────────────────────────────────────────────

export type CompleteGuideInviteResult =
  | { ok: true; guideUrl: string; alreadyDone: boolean }
  | { ok: false; status: number; error: string };

/**
 * The couple tapped "Send my guide": record their consent (with proof), update
 * their details, and put them into the same Phase 1 → Phase 2 → AI flow a
 * listing-form lead gets. Idempotent: a second tap never sends anything twice.
 */
export async function completeGuideInvite(input: {
  token: string;
  phone: string;
  email: string;
  weddingDate?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
}): Promise<CompleteGuideInviteResult> {
  const ids = verifyGuideInviteToken(input.token);
  if (!ids) return { ok: false, status: 400, error: 'This link has expired. Please reply to our email and we\'ll send your guide.' };
  const { leadId, venueId } = ids;

  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, status: 400, error: 'Please enter a valid mobile number.' };
  const email = (input.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  const weddingDate = /^\d{4}-\d{2}-\d{2}$/.test(input.weddingDate ?? '') ? (input.weddingDate as string) : null;

  const { data: leadRow } = await supabaseAdmin
    .from('leads')
    .select('id, email, first_name, last_name, wedding_date, created_at')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!leadRow) return { ok: false, status: 404, error: 'We couldn\'t find your inquiry. Please reply to our email.' };
  const lead = leadRow as { email: string | null; first_name: string | null; last_name: string | null; wedding_date: string | null; created_at: string };

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('name, guide_short_code')
    .eq('id', venueId)
    .maybeSingle();
  const venue = (venueRow ?? {}) as { name?: string | null; guide_short_code?: string | null };
  const guideUrl = buildGuideShortUrl(APP_URL, venueId, leadId, venue.guide_short_code ?? null);

  // Claim the tap. Only the first one proceeds; a repeat just shows the guide.
  const { data: invite } = await supabaseAdmin
    .from('guide_invites')
    .select('id, tapped_at, fallback_at')
    .eq('lead_id', leadId)
    .maybeSingle();
  const inv = invite as { id: string; tapped_at: string | null; fallback_at: string | null } | null;
  if (inv?.tapped_at) return { ok: true, guideUrl, alreadyDone: true };
  const tappedAt = new Date().toISOString();
  if (inv) {
    const { data: claimed } = await supabaseAdmin
      .from('guide_invites')
      .update({ tapped_at: tappedAt })
      .eq('id', inv.id)
      .is('tapped_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) return { ok: true, guideUrl, alreadyDone: true };
  } else {
    // No invite row (an older lead, or the table arrived after the invite):
    // record it now so a repeat tap is still recognised.
    await supabaseAdmin.from('guide_invites').insert({ venue_id: venueId, lead_id: leadId, tapped_at: tappedAt });
  }
  const afterFallback = !!inv?.fallback_at;

  // Their details, as they confirmed them.
  const previousEmail = (lead.email ?? '').trim().toLowerCase();
  const patch: Record<string, unknown> = { phone, updated_at: tappedAt };
  if (email !== previousEmail) patch.email = email;
  if (weddingDate && !lead.wedding_date) patch.wedding_date = weddingDate;
  await supabaseAdmin.from('leads').update(patch).eq('id', leadId).eq('venue_id', venueId);
  await syncLeadAnswersToContact(venueId, email, {
    firstName: lead.first_name,
    lastName: lead.last_name,
    phone,
    guestCount: null,
    timeline: null,
    venueMatters: null,
    weddingDate: weddingDate && !lead.wedding_date ? weddingDate : null,
  });
  // Conversations are keyed by email: a corrected address is a new thread,
  // which should open with the same "New Lead Opportunity" marker.
  if (email !== previousEmail) await logNewLeadOpportunity(venueId, leadId, lead.created_at);

  // Consent: the proof first, then the switch every SMS path reads.
  await recordSmsConsentEvidence({
    venueId,
    leadId,
    phone,
    email,
    source: 'guide_invite',
    sourceDetail: 'guide_page',
    disclosureVersion: SMS_CONSENT_VERSION,
    disclosureText: withPolicyLinks(guidePageConsentText(venue.name)),
    ip: input.ip,
    userAgent: input.userAgent,
    pageUrl: input.pageUrl,
  });
  await grantSmsConsentForLeadIds({ venueId, leadIds: [leadId], source: 'guide_invite' });
  await markThread(venueId, leadId, '📱 Opted in to texts from the guide invite.');

  // Now exactly what a listing-form lead gets.
  if (afterFallback) {
    // The guide was already emailed and Phase 2 already runs (1h fallback):
    // send the text guide only; the sequence's SMS steps now send too.
    void sendBookingSystemGuide(venueId, leadId, { channels: 'sms' }).catch((e) =>
      console.error('[guide-invite] SMS guide failed:', e),
    );
  } else {
    void sendBookingSystemGuide(venueId, leadId).catch((e) =>
      console.error('[guide-invite] guide failed:', e),
    );
    await startPhase2(venueId, leadId);
  }

  return { ok: true, guideUrl, alreadyDone: false };
}

// ── Reminder + fallback (marketing cron) ─────────────────────────────────────

/**
 * No tap within an hour: the guide goes by email and Phase 2 starts without
 * SMS (the invite link keeps working, so tapping later still opts them in to
 * texts). A couple who has replied is left to the venue (no automated
 * sequence on top of a live conversation). Each row is claimed with a
 * conditional update, so overlapping cron runs never double-send.
 * A missing table (migration 259 not applied) is a no-op.
 */
export async function processGuideInvites(now: Date = new Date()): Promise<{ fallbacks: number }> {
  let fallbacks = 0;
  const nowIso = now.toISOString();

  type Row = { id: string; venue_id: string; lead_id: string; invite_sent_at: string };

  /** Has the couple written to the venue since the invite went out? */
  const repliedSinceInvite = async (row: Row): Promise<boolean> => {
    const { data } = await supabaseAdmin.from('leads').select('last_inbound_at').eq('id', row.lead_id).maybeSingle();
    const at = (data as { last_inbound_at?: string | null } | null)?.last_inbound_at ?? null;
    return !!at && new Date(at).getTime() > new Date(row.invite_sent_at).getTime();
  };

  // Close an invite out (tap no longer expected). Only one run wins the claim.
  const claimFallback = async (row: Row): Promise<boolean> => {
    const { data } = await supabaseAdmin
      .from('guide_invites')
      .update({ fallback_at: nowIso })
      .eq('id', row.id)
      .is('tapped_at', null)
      .is('fallback_at', null)
      .select('id')
      .maybeSingle();
    return !!data;
  };

  // No tap within an hour: guide by email + Phase 2 (its SMS steps skip without
  //    consent). A couple who replied instead is left to the venue.
  const { data: overdue, error: overdueErr } = await supabaseAdmin
    .from('guide_invites')
    .select('id, venue_id, lead_id, invite_sent_at')
    .is('tapped_at', null)
    .is('fallback_at', null)
    .lte('invite_sent_at', new Date(now.getTime() - FALLBACK_AFTER_MS).toISOString())
    .order('invite_sent_at', { ascending: true })
    .limit(CRON_BATCH);
  if (overdueErr) return { fallbacks }; // table missing → feature not live yet

  for (const row of (overdue ?? []) as Row[]) {
    const replied = await repliedSinceInvite(row);
    if (!(await claimFallback(row))) continue;
    if (replied) {
      await markThread(row.venue_id, row.lead_id, 'They replied before tapping "Send me my guide" — over to you (no automated follow-up started).');
      continue;
    }
    void sendBookingSystemGuide(row.venue_id, row.lead_id, { channels: 'email' }).catch((e) =>
      console.error('[guide-invite] fallback guide failed:', e),
    );
    await startPhase2(row.venue_id, row.lead_id);
    await markThread(row.venue_id, row.lead_id, 'No tap after an hour — guide emailed and follow-up started (no texts until they opt in).');
    fallbacks++;
  }

  return { fallbacks };
}
