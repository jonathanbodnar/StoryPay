import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';
import {
  parseEmailDefinition,
  parseSegment,
  type MarketingEmailDefinition,
} from '@/lib/marketing-email-schema';
import { mergeMarketingFields, renderMarketingEmailHtml, type MergeFieldRecord } from '@/lib/marketing-email-render';
import { injectVenueDataIntoDefinition } from '@/lib/marketing-email-injection';
import { resolveCampaignRecipients } from '@/lib/marketing-email-audience';
import { signMarketingOpenToken, signMarketingUnsubscribeToken } from '@/lib/marketing-email-tokens';
import { addCalendarDaysYmd, resolveVenueTimezone } from '@/lib/venue-timezone';
import { formatInTimeZone } from 'date-fns-tz';
import { logStepExecution } from '@/lib/workflow-execution-logs';

const BATCH = 25;

/** Returns the new enrollment id, or null if already enrolled / error. */
async function enrollIfNew(automationId: string, venueId: string, leadId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .insert({
      automation_id: automationId,
      venue_id: venueId,
      lead_id: leadId,
      current_step_index: 0,
      status: 'active',
      next_run_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error?.code === '23505') return null; // already enrolled
  if (error) { console.error('[marketing enroll]', error); return null; }
  return (data as { id: string }).id;
}

/** All trigger sources (primary + extras) for a workflow row, normalized to a flat shape. */
type AutoTriggerRow = {
  id: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
};
type FlatTrigger = {
  type: string;
  tag_ids?: string[];
  to_stage_ids?: string[];
  trigger_link_ids?: string[];
  form_ids?: string[];
  days_after_wedding?: number;
};
function flatTriggersFor(row: AutoTriggerRow): FlatTrigger[] {
  const cfg = (row.trigger_config || {}) as Record<string, unknown> & { extra_triggers?: FlatTrigger[] };
  const primary: FlatTrigger = {
    type: row.trigger_type,
    tag_ids: cfg.tag_ids as string[] | undefined,
    to_stage_ids: cfg.to_stage_ids as string[] | undefined,
    trigger_link_ids: cfg.trigger_link_ids as string[] | undefined,
    form_ids: cfg.form_ids as string[] | undefined,
    days_after_wedding: cfg.days_after_wedding as number | undefined,
  };
  const extras = Array.isArray(cfg.extra_triggers) ? cfg.extra_triggers : [];
  return [primary, ...extras];
}

/**
 * Loads every active automation for the venue (small list per venue) so we can
 * match against both the primary trigger AND extra_triggers in JSON. The
 * previous implementation filtered by trigger_type at the SQL layer, which
 * silently ignored multi-trigger workflows whose primary trigger differed
 * from the trigger we are processing.
 */
async function loadVenueActiveAutomations(venueId: string): Promise<AutoTriggerRow[]> {
  const { data } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, trigger_type, trigger_config')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  return (data ?? []) as AutoTriggerRow[];
}

export async function onMarketingTagAdded(
  venueId: string,
  leadId: string,
  addedTagIds: string[],
): Promise<void> {
  if (!addedTagIds.length) return;
  const autos = await loadVenueActiveAutomations(venueId);
  for (const row of autos) {
    const matched = flatTriggersFor(row).some((t) => {
      if (t.type !== 'tag_added') return false;
      const want = t.tag_ids?.filter(Boolean) ?? [];
      return want.length === 0
        ? addedTagIds.length > 0
        : addedTagIds.some((id) => want.includes(id));
    });
    if (matched) await enrollIfNew(row.id, venueId, leadId);
  }
}

export async function onMarketingStageChanged(
  venueId: string,
  leadId: string,
  newStageId: string | null,
): Promise<void> {
  if (!newStageId) return;
  const autos = await loadVenueActiveAutomations(venueId);
  for (const row of autos) {
    const matched = flatTriggersFor(row).some((t) => {
      if (t.type !== 'stage_changed') return false;
      const stages = t.to_stage_ids?.filter(Boolean) ?? [];
      return stages.length > 0 && stages.includes(newStageId);
    });
    if (matched) await enrollIfNew(row.id, venueId, leadId);
  }
}

export async function onMarketingTriggerLinkClick(
  venueId: string,
  leadId: string | null,
  triggerLinkId: string,
): Promise<void> {
  if (!leadId) return;
  const autos = await loadVenueActiveAutomations(venueId);
  for (const row of autos) {
    const matched = flatTriggersFor(row).some((t) => {
      if (t.type !== 'trigger_link_click') return false;
      const links = t.trigger_link_ids?.filter(Boolean) ?? [];
      return links.length > 0 && links.includes(triggerLinkId);
    });
    if (matched) await enrollIfNew(row.id, venueId, leadId);
  }
}

/** Daily cron: enroll leads whose wedding_date + offset matches today in the venue timezone. */
export async function processWeddingDateFollowupAutomations(): Promise<{ enrolled: number }> {
  // Pull every active automation — we'll inspect both the primary trigger and
  // any extra_triggers to find all `wedding_date_followup` offsets.
  const { data: autos, error } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, venue_id, trigger_type, trigger_config')
    .eq('status', 'active');
  if (error || !autos?.length) return { enrolled: 0 };

  const byVenue = new Map<string, Array<{ id: string; days: number }>>();
  for (const row of autos) {
    const vid = row.venue_id as string;
    const wedTriggers = flatTriggersFor(row as AutoTriggerRow).filter((t) => t.type === 'wedding_date_followup');
    if (!wedTriggers.length) continue;
    const offsets = new Set<number>();
    for (const t of wedTriggers) {
      offsets.add(Math.max(0, Math.min(3650, Number(t.days_after_wedding ?? 0) || 0)));
    }
    const list = byVenue.get(vid) ?? [];
    for (const days of offsets) list.push({ id: row.id as string, days });
    byVenue.set(vid, list);
  }

  const venueIds = [...byVenue.keys()];
  const { data: venues } = await supabaseAdmin.from('venues').select('id, timezone').in('id', venueIds);

  const tzMap = new Map<string, string>();
  for (const v of venues ?? []) {
    tzMap.set(v.id as string, resolveVenueTimezone(v.timezone as string | null));
  }

  let enrolled = 0;
  const now = new Date();

  for (const [venueId, autoList] of byVenue) {
    const tz = tzMap.get(venueId) ?? resolveVenueTimezone(null);
    const todayYmd = formatInTimeZone(now, tz, 'yyyy-MM-dd');

    const { data: leads, error: leErr } = await supabaseAdmin
      .from('leads')
      .select('id, wedding_date')
      .eq('venue_id', venueId)
      .not('wedding_date', 'is', null);
    if (leErr || !leads?.length) continue;

    for (const lead of leads) {
      const wd = lead.wedding_date as string | null;
      if (!wd) continue;
      const ymd = wd.slice(0, 10);
      for (const auto of autoList) {
        const target = addCalendarDaysYmd(ymd, auto.days, tz);
        if (target !== todayYmd) continue;
        await enrollIfNew(auto.id, venueId, lead.id as string);
        enrolled++;
      }
    }
  }

  return { enrolled };
}

/**
 * When a marketing form is submitted, enroll the matching lead in any active
 * `form_submitted` workflow whose form_ids list includes this form (empty list = any form).
 *
 * The caller resolves `leadId` after upserting the lead row (form submit flow).
 * Workflows that don't list this form id are skipped.
 */
export async function onMarketingFormSubmitted(
  venueId: string,
  leadId: string,
  formId: string,
): Promise<void> {
  if (!leadId || !formId) return;
  const autos = await loadVenueActiveAutomations(venueId);
  for (const row of autos) {
    const matched = flatTriggersFor(row).some((t) => {
      if (t.type !== 'form_submitted') return false;
      const want = t.form_ids?.filter(Boolean) ?? [];
      return want.length === 0 ? true : want.includes(formId);
    });
    if (!matched) continue;
    const enrollmentId = await enrollIfNew(row.id, venueId, leadId);
    // Speed-to-lead: immediately execute the first step instead of waiting
    // for the next cron tick. If step 1 is a Wait it will schedule itself
    // for later and return; if it's SMS/Email it fires right now.
    if (enrollmentId) {
      await processEnrollmentChain({
        id: enrollmentId,
        automation_id: row.id,
        venue_id: venueId,
        lead_id: leadId,
        current_step_index: 0,
      });
    }
  }
}

/**
 * Halt all active automation enrollments for a lead because they replied
 * (email reply detected by the inbound webhook, or SMS reply later).
 * Returns the number of enrollments that were halted so the caller can
 * decide whether to send the venue owner a "they replied" notification.
 */
export async function haltAutomationEnrollmentsForReply(
  venueId: string,
  leadId: string,
  reason: 'email_reply' | 'sms_reply' = 'email_reply',
): Promise<number> {
  if (!leadId) return 0;
  const { data: rows, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .update({
      status: 'halted_by_reply',
      completed_at: new Date().toISOString(),
      last_error: reason,
    })
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .select('id');
  if (error) {
    console.error('[automation halt-by-reply]', error);
    return 0;
  }
  return rows?.length ?? 0;
}

/** When a proposal is marked paid, enroll matching lead (by email) in proposal_paid workflows. */
export async function onMarketingProposalPaid(
  venueId: string,
  customerEmail: string | null | undefined,
): Promise<void> {
  const raw = typeof customerEmail === 'string' ? customerEmail.trim() : '';
  if (!raw) return;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('email', raw)
    .maybeSingle();
  if (!lead?.id) return;

  const autos = await loadVenueActiveAutomations(venueId);
  for (const row of autos) {
    if (!flatTriggersFor(row).some((t) => t.type === 'proposal_paid')) continue;
    await enrollIfNew(row.id, venueId, lead.id as string);
  }
}

export async function buildMergeVars(
  venueId: string,
  leadId: string,
  appOrigin: string,
  opts?: { forSms?: boolean },
): Promise<MergeFieldRecord | null> {
  const forSms = opts?.forSms === true;
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, email, location_full, location_city, location_state, owner_first_name, owner_last_name, notification_phone, brand_website')
    .eq('id', venueId)
    .maybeSingle();
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, email, phone, first_name, last_name, name, wedding_date, guest_count, marketing_email_opt_in, sms_dnd')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return null;
  const emailRaw = String(lead.email || '').trim();
  if (forSms && (lead as { sms_dnd?: boolean }).sms_dnd === true) return null;
  if (forSms && emailRaw) {
    const { data: vcDnd } = await supabaseAdmin
      .from('venue_customers')
      .select('sms_dnd')
      .eq('venue_id', venueId)
      .ilike('customer_email', emailRaw)
      .maybeSingle();
    if (vcDnd?.sms_dnd === true) return null;
  }
  if (!forSms) {
    if (!emailRaw) return null;
    if ((lead as { marketing_email_opt_in?: boolean }).marketing_email_opt_in === false) return null;
  }
  const fn = (lead.first_name as string | null)?.trim() || (lead.name as string | null)?.split(/\s+/)[0] || 'there';
  const ln = (lead.last_name as string | null)?.trim() || '';
  const token = signMarketingUnsubscribeToken(venueId, leadId);
  const base = appOrigin.replace(/\/$/, '');
  const unsub = `${base}/api/public/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
  const resub = `${base}/api/public/marketing/resubscribe?token=${encodeURIComponent(token)}`;
  const prefs = `${base}/u/${encodeURIComponent(token)}/manage`;
  const wd = lead.wedding_date as string | null;
  let wedding_date_nice = '';
  let wedding_month = '';
  if (wd) {
    try {
      const d = new Date(`${wd}T12:00:00Z`);
      wedding_date_nice = d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      wedding_month = d.toLocaleDateString('en-US', { month: 'long' });
    } catch {
      wedding_date_nice = wd;
      wedding_month = '';
    }
  }
  const gc = lead.guest_count as number | null;
  const email =
    emailRaw ||
    `lead.${String(lead.id).replace(/-/g, '').slice(0, 12)}@sms-auto.storypay.placeholder`;
  const fullAddr = (venue?.location_full as string)
    || ([venue?.location_city, venue?.location_state].filter(Boolean).join(', '))
    || '';
  const venueName   = (venue?.name as string) || 'Your venue';
  const ownerFirst  = (venue?.owner_first_name as string | null)?.trim() || '';
  const ownerLast   = (venue?.owner_last_name  as string | null)?.trim() || '';
  const ownerName   = [ownerFirst, ownerLast].filter(Boolean).join(' ');
  const now         = new Date();
  const fullName    = [fn, ln].filter(Boolean).join(' ');
  return {
    // ── Flat legacy keys (kept for all existing templates) ────────────────
    first_name:         fn,
    last_name:          ln,
    email,
    venue_name:         venueName,
    venue_full_address: fullAddr,
    venue_city:         (venue?.location_city as string) || '',
    venue_state:        (venue?.location_state as string) || '',
    unsubscribe_url:    unsub,
    resubscribe_url:    resub,
    preferences_url:    prefs,
    wedding_date:       wedding_date_nice || wd || '',
    wedding_date_nice:  wedding_date_nice || '',
    wedding_month:      wedding_month || '',
    guest_count:        gc != null ? String(gc) : '',
    // ── Canonical dot-notation keys (new unified system) ─────────────────
    'contact.first_name':        fn,
    'contact.last_name':         ln,
    'contact.name':              fullName || fn,
    'contact.full_name':         fullName || fn,
    'contact.email':             email,
    'contact.phone':             (lead.phone as string | null) || '',
    'venue.name':                venueName,
    'venue.owner_name':          ownerName,
    'venue.owner_first_name':    ownerFirst,
    'venue.email':               (venue?.email as string | null) || '',
    'venue.phone':               (venue?.notification_phone as string | null) || '',
    'venue.address':             fullAddr,
    'venue.city':                (venue?.location_city as string) || '',
    'venue.state':               (venue?.location_state as string) || '',
    'venue.website':             (venue?.brand_website as string | null) || '',
    'lead.wedding_date':         wedding_date_nice || wd || '',
    'lead.wedding_month':        wedding_month || '',
    'lead.guest_count':          gc != null ? String(gc) : '',
    'marketing.unsubscribe_url': unsub,
    'marketing.resubscribe_url': resub,
    'marketing.preferences_url': prefs,
    'system.date':               now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    'system.year':               String(now.getFullYear()),
  };
}

async function resolvePhoneForLead(venueId: string, leadId: string): Promise<string | null> {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('phone, email')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return null;
  const direct = normalizePhone(lead.phone as string | null);
  if (direct) return direct;
  const em = String(lead.email || '').trim().toLowerCase();
  if (!em) return null;
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('phone')
    .eq('venue_id', venueId)
    .ilike('customer_email', em)
    .maybeSingle();
  return normalizePhone(vc?.phone as string | null);
}

// ─── Conversation thread helpers ─────────────────────────────────────────────

/**
 * Given a lead, finds (or creates) a venue_customer record and a conversation
 * thread for them. Returns the thread ID so automated messages can be logged.
 * Never throws — returns null on any error so callers can safely fire-and-forget.
 */
async function findOrCreateThreadForLead(
  venueId: string,
  leadId: string,
): Promise<string | null> {
  try {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('email, first_name, last_name, name, phone')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!lead) return null;

    const email = String(lead.email || '').trim().toLowerCase();
    if (!email) return null;

    // Find matching venue_customer
    let { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();

    // Create one if missing
    if (!vc) {
      const fn = (lead.first_name as string | null)?.trim() || (lead.name as string | null)?.split(/\s+/)[0] || '';
      const ln = (lead.last_name as string | null)?.trim() || '';
      const { data: created } = await supabaseAdmin
        .from('venue_customers')
        .insert({
          venue_id: venueId,
          customer_email: email,
          first_name: fn || null,
          last_name: ln || null,
          phone: (lead.phone as string | null) || null,
        })
        .select('id')
        .single();
      vc = created;
    }
    if (!vc) return null;

    // Find existing thread
    const { data: existing } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .eq('venue_id', venueId)
      .eq('venue_customer_id', (vc as { id: string }).id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) return (existing as { id: string }).id;

    // Create a new thread
    const { data: thread } = await supabaseAdmin
      .from('conversation_threads')
      .insert({
        venue_id: venueId,
        venue_customer_id: (vc as { id: string }).id,
        subject: 'Lead Conversation',
        external_reply_channel: 'sms',
      })
      .select('id')
      .single();

    return thread ? (thread as { id: string }).id : null;
  } catch (e) {
    console.error('[worker] findOrCreateThreadForLead error (non-fatal):', e);
    return null;
  }
}

/**
 * Writes a system-generated message to a conversation thread.
 * Updates the thread summary so it appears at the top of the inbox.
 * Never throws.
 */
async function logToConversationThread(opts: {
  threadId: string;
  venueId: string;
  channel: 'sms' | 'email';
  body: string;
}): Promise<void> {
  try {
    const preview = opts.body.replace(/\s+/g, ' ').trim().slice(0, 240);
    await supabaseAdmin.from('conversation_messages').insert({
      thread_id: opts.threadId,
      visibility: 'external',
      channel: opts.channel,
      body: opts.body,
      sender_kind: 'system',
      external_email_sent: true,
    });
    // The DB trigger updates last_message_at/preview/visibility automatically,
    // but we also keep external_reply_channel correct on the thread.
    await supabaseAdmin
      .from('conversation_threads')
      .update({
        external_reply_channel: opts.channel,
        last_message_preview: preview,
        last_message_at: new Date().toISOString(),
        last_message_visibility: 'external',
      })
      .eq('id', opts.threadId)
      .eq('venue_id', opts.venueId);
  } catch (e) {
    console.error('[worker] logToConversationThread error (non-fatal):', e);
  }
}

async function sendAutomationSmsToLead(
  venueId: string,
  leadId: string,
  bodyTemplate: string,
  mediaUrls?: string[],
): Promise<{ ok: boolean; error?: string; mergedBody?: string }> {
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const vars = await buildMergeVars(venueId, leadId, appOrigin, { forSms: true });
  if (!vars) return { ok: false, error: 'suppressed' };
  const phone = await resolvePhoneForLead(venueId, leadId);
  if (!phone) return { ok: false, error: 'no_phone' };
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('ghl_access_token, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();
  // Allow sending when an agency-level key is set in the environment — that key
  // works for all sub-accounts without per-venue OAuth, so don't require the
  // ghl_connected flag in that case.
  const hasAgencyKey = !!(process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY);
  const venueConnected = (venue as { ghl_connected?: boolean } | null)?.ghl_connected === true;
  if (!hasAgencyKey && !venueConnected) {
    console.error(`[worker] SMS skipped for venue ${venueId}: GHL not connected and no agency key set`);
    return { ok: false, error: 'ghl_not_connected' };
  }
  const token = getGhlToken(venue as { ghl_access_token?: string | null });
  const loc = venue?.ghl_location_id as string | null;
  if (!token || !loc) {
    console.error(`[worker] SMS skipped for venue ${venueId}: token=${!!token} loc=${loc}`);
    return { ok: false, error: 'ghl_not_configured' };
  }
  const mergedBody = mergeMarketingFields(bodyTemplate, vars).trim();
  if (!mergedBody) return { ok: false, error: 'empty_after_merge' };
  try {
    const contactId = await findOrCreateContact(token, loc, {
      email: vars.email,
      phone,
      firstName: vars.first_name,
      lastName: vars.last_name,
    });
    if (!contactId) return { ok: false, error: 'no_contact' };
    await sendSms(token, loc, contactId, mergedBody, mediaUrls?.length ? mediaUrls : undefined);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'sms_failed' };
  }
  return { ok: true, mergedBody };
}

/**
 * Send a "quick compose" email — used by workflow send_email steps in quick
 * mode. Renders subject + body inline (merge vars resolved) and wraps the body
 * in a minimal HTML shell so newlines render correctly across email clients.
 */
async function sendQuickEmailToLead(
  venueId: string,
  leadId: string,
  spec: {
    subject: string; body: string; preheader?: string;
    from_name?: string; from_email?: string;
    cc?: string; bcc?: string;
  },
): Promise<{ ok: boolean; error?: string; mergedSubject?: string }> {
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storyvenue.com';
  const vars = await buildMergeVars(venueId, leadId, appOrigin);
  if (!vars) return { ok: false, error: 'opt_out' };
  if (!vars.email) return { ok: false, error: 'No email' };
  const { data: sup } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .maybeSingle();
  if (sup) return { ok: false, error: 'suppressed' };

  const mergedSubject   = mergeMarketingFields(spec.subject, vars);
  const mergedPreheader = mergeMarketingFields(spec.preheader ?? '', vars);
  const mergedBody      = mergeMarketingFields(spec.body, vars);
  const mergedFromName  = mergeMarketingFields(spec.from_name  ?? '', vars).trim();
  const mergedFromEmail = mergeMarketingFields(spec.from_email ?? '', vars).trim();
  const mergedCc        = mergeMarketingFields(spec.cc  ?? '', vars).trim();
  const mergedBcc       = mergeMarketingFields(spec.bcc ?? '', vars).trim();

  const escapeHtml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // If body contains HTML tags, treat as HTML; otherwise convert plain text
  // (newlines → <br>, paragraphs preserved) to a simple wrapped HTML doc.
  const looksLikeHtml = /<\/?[a-z][\s\S]*?>/i.test(mergedBody);
  const bodyHtml = looksLikeHtml
    ? mergedBody
    : escapeHtml(mergedBody).replace(/\n/g, '<br>');
  const preheaderComment = mergedPreheader.trim()
    ? `<!-- preheader: ${mergedPreheader.replace(/<!--/g, '').slice(0, 200)} -->\n`
    : '';
  const html = `${preheaderComment}<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(mergedSubject)}</title></head><body style="margin:0;padding:0;background:#f6f7f9;font-family:Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">${bodyHtml}</div></body></html>`;

  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
  const fromName = mergedFromName || `${(venue?.name as string) || 'Venue'} via StoryVenue`;

  const r = await sendEmail({
    to: vars.email,
    subject: mergedSubject || '(no subject)',
    html,
    from: mergedFromEmail
      ? { name: fromName, email: mergedFromEmail }
      : { name: fromName },
    cc:  mergedCc  ? mergedCc.split(/[,\s;]+/).filter(Boolean)  : undefined,
    bcc: mergedBcc ? mergedBcc.split(/[,\s;]+/).filter(Boolean) : undefined,
  });
  return r.success ? { ok: true, mergedSubject } : { ok: false, error: r.error };
}

async function sendTemplateToLead(
  venueId: string,
  leadId: string,
  definition: MarketingEmailDefinition,
  subject: string,
  preheader: string,
  opts?: { campaignRecipientId?: string },
): Promise<{ ok: boolean; error?: string; mergedSubject?: string }> {
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const vars = await buildMergeVars(venueId, leadId, appOrigin);
  if (!vars) return { ok: false, error: 'opt_out' };
  if (!vars.email) return { ok: false, error: 'No email' };
  const { data: sup } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .maybeSingle();
  if (sup) return { ok: false, error: 'suppressed' };
  // Pull venue's saved social network links and inject them into any social
  // blocks in the definition. The block schema doesn't store URLs per-block —
  // they live exclusively in `venues.brand_socials`.
  const { data: venueSocialsRow } = await supabaseAdmin
    .from('venues')
    .select('brand_socials')
    .eq('id', venueId)
    .maybeSingle();
  const rawSocials = (venueSocialsRow as { brand_socials?: unknown } | null)?.brand_socials;
  const venueSocials = Array.isArray(rawSocials)
    ? rawSocials
        .map((s): { platform: string; url: string } | null => {
          if (!s || typeof s !== 'object') return null;
          const p = String((s as { platform?: unknown }).platform ?? '').trim().toLowerCase();
          const u = String((s as { url?: unknown }).url ?? '').trim();
          return p && u ? { platform: p, url: u } : null;
        })
        .filter((s): s is { platform: string; url: string } => s !== null)
    : [];
  const inflatedDef = injectVenueDataIntoDefinition(definition, venueSocials);
  let html = renderMarketingEmailHtml(inflatedDef, vars);
  if (opts?.campaignRecipientId) {
    const t = signMarketingOpenToken(opts.campaignRecipientId);
    const pixel = `${appOrigin.replace(/\/$/, '')}/api/public/marketing/email-open?t=${encodeURIComponent(t)}`;
    html = html.replace('</body>', `<img src="${pixel}" width="1" height="1" alt="" style="display:block;border:0" /></body>`);
  }
  const mergedSubject = mergeMarketingFields(subject, vars);
  const mergedPre = mergeMarketingFields(preheader, vars);
  const fullHtml =
    mergedPre.trim() ?
      `<!-- preheader: ${mergedPre.replace(/<!--/g, '').slice(0, 200)} -->\n${html}`
    : html;
  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
  const fromName = `${(venue?.name as string) || 'Venue'} via StoryVenue`;
  const r = await sendEmail({
    to: vars.email,
    subject: mergedSubject,
    html: fullHtml,
    from: { name: fromName },
  });
  return r.success ? { ok: true, mergedSubject } : { ok: false, error: r.error };
}

export async function processAutomationEnrollmentsBatch(): Promise<{ processed: number }> {
  const now = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, automation_id, venue_id, lead_id, current_step_index, status')
    .eq('status', 'active')
    .lte('next_run_at', now)
    .limit(BATCH);
  if (error || !due?.length) return { processed: 0 };

  let n = 0;
  for (const en of due) {
    const result = await processEnrollmentChain(en as {
      id: string;
      automation_id: string;
      venue_id: string;
      lead_id: string;
      current_step_index: number;
    });
    if (result !== 'unknown') n++;
  }
  return { processed: n };
}

/**
 * Immediately execute the current step for the given enrollment IDs.
 * Used by the "Advance selected" manual trigger in the workflow UI so
 * the step fires right away instead of waiting for the next cron tick.
 */
export async function runEnrollmentsNow(enrollmentIds: string[]): Promise<{ processed: number }> {
  if (!enrollmentIds.length) return { processed: 0 };
  const { data, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, automation_id, venue_id, lead_id, current_step_index, status')
    .in('id', enrollmentIds)
    .in('status', ['active', 'failed']); // allow re-running failed enrollments
  if (error || !data?.length) return { processed: 0 };

  // Reset any failed enrollments back to active so processOneEnrollment can run them.
  const failedIds = data.filter((r) => r.status === 'failed').map((r) => r.id as string);
  if (failedIds.length) {
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ status: 'active', last_error: null })
      .in('id', failedIds);
  }

  let n = 0;
  for (const en of data) {
    const result = await processEnrollmentChain(
      en as { id: string; automation_id: string; venue_id: string; lead_id: string; current_step_index: number },
    );
    if (result !== 'unknown') n++;
  }
  return { processed: n };
}

// `logStepExecution` is now provided by '@/lib/workflow-execution-logs' so the
// "Send Test" routes can share the same writer (and the same column shape).

/**
 * Result of executing one workflow step:
 *  'advanced'  – step executed, next step is due immediately (keep chaining)
 *  'delayed'   – a Wait step scheduled the next run in the future (stop chaining)
 *  'completed' – enrollment finished
 *  'failed'    – enrollment marked failed (stop chaining)
 *  'unknown'   – unrecognised step type (stop chaining)
 */
type StepResult = 'advanced' | 'delayed' | 'completed' | 'failed' | 'unknown';

async function processOneEnrollment(en: {
  id: string;
  automation_id: string;
  venue_id: string;
  lead_id: string;
  current_step_index: number;
}): Promise<StepResult> {
  const { data: steps, error: se } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('id, step_order, step_type, config_json')
    .eq('automation_id', en.automation_id)
    .order('step_order', { ascending: true });
  if (se || !steps?.length) {
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ status: 'failed', last_error: 'No steps' })
      .eq('id', en.id);
    return 'failed';
  }
  const sorted = [...steps].sort((a, b) => (a.step_order as number) - (b.step_order as number));
  const idx = en.current_step_index;
  if (idx >= sorted.length) {
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() })
      .eq('id', en.id);
    return 'completed';
  }
  const step = sorted[idx] as { step_type: string; config_json: Record<string, unknown> };
  if (step.step_type === 'delay') {
    const minutes = Number((step.config_json as { delay_minutes?: number }).delay_minutes ?? 60);
    const ms = Math.max(1, Math.min(10080, minutes)) * 60 * 1000;
    const next = new Date(Date.now() + ms).toISOString();
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ current_step_index: idx + 1, next_run_at: next })
      .eq('id', en.id);
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'delay', status: 'success' });
    return 'delayed';
  }
  if (step.step_type === 'send_email') {
    const cfg = step.config_json as {
      mode?: string; template_id?: string;
      from_name?: string; from_email?: string; cc?: string; bcc?: string;
      subject?: string; preheader?: string; body?: string;
      track_clicks?: boolean;
    };
    const mode = cfg.mode === 'template' ? 'template' : (cfg.mode === 'quick' ? 'quick' : 'template');

    let send: { ok: boolean; error?: string; mergedSubject?: string };
    if (mode === 'quick') {
      // ── Quick compose: render subject/body inline with merge vars ───────
      send = await sendQuickEmailToLead(en.venue_id, en.lead_id, {
        subject:    String(cfg.subject ?? ''),
        body:       String(cfg.body ?? ''),
        preheader:  typeof cfg.preheader  === 'string' ? cfg.preheader  : undefined,
        from_name:  typeof cfg.from_name  === 'string' ? cfg.from_name  : undefined,
        from_email: typeof cfg.from_email === 'string' ? cfg.from_email : undefined,
        cc:         typeof cfg.cc         === 'string' ? cfg.cc         : undefined,
        bcc:        typeof cfg.bcc        === 'string' ? cfg.bcc        : undefined,
      });
    } else {
      // ── Template mode: existing path ──────────────────────────────────────
      const templateId = String(cfg.template_id || '');
      if (!templateId) {
        await supabaseAdmin
          .from('marketing_automation_enrollments')
          .update({ status: 'failed', last_error: 'Missing template_id' })
          .eq('id', en.id);
        return 'failed';
      }
      const { data: tmpl } = await supabaseAdmin
        .from('marketing_email_templates')
        .select('subject, preheader, definition_json')
        .eq('id', templateId)
        .eq('venue_id', en.venue_id)
        .maybeSingle();
      if (!tmpl) {
        await supabaseAdmin
          .from('marketing_automation_enrollments')
          .update({ status: 'failed', last_error: 'Template not found' })
          .eq('id', en.id);
        return 'failed';
      }
      const def = parseEmailDefinition(tmpl.definition_json);
      send = await sendTemplateToLead(en.venue_id, en.lead_id, def, tmpl.subject as string, tmpl.preheader as string, undefined);
    }
    // 'suppressed' = unsubscribed, 'opt_out' = marketing_email_opt_in is false.
    // Both are soft skips — advance to the next step rather than failing the enrollment.
    const emailSkipped = send.error === 'suppressed' || send.error === 'opt_out';
    if (!send.ok && !emailSkipped) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: send.error ?? 'send failed' })
        .eq('id', en.id);
      void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'send_email', status: 'failed', error_text: send.error ?? 'send failed' });
      return 'failed';
    }
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'send_email', status: emailSkipped ? 'skipped' : 'success' });
    if (send.ok && send.mergedSubject) {
      void findOrCreateThreadForLead(en.venue_id, en.lead_id).then((threadId) => {
        if (threadId) void logToConversationThread({ threadId, venueId: en.venue_id, channel: 'email', body: `[Email] ${send.mergedSubject}` });
      });
    }
    const nextIdx = idx + 1;
    if (nextIdx >= sorted.length) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() })
        .eq('id', en.id);
      return 'completed';
    }
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ current_step_index: nextIdx, next_run_at: new Date().toISOString() })
      .eq('id', en.id);
    return 'advanced';
  }
  if (step.step_type === 'send_sms') {
    const cfg = step.config_json as { body?: string; media_urls?: string[] };
    const body = String(cfg.body || '').trim();
    if (!body) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: 'Empty SMS body' })
        .eq('id', en.id);
      return 'failed';
    }
    const send = await sendAutomationSmsToLead(en.venue_id, en.lead_id, body, cfg.media_urls);
    console.log(`[worker] SMS step enrollment=${en.id} ok=${send.ok} error=${send.error ?? 'none'}`);
    if (!send.ok && send.error !== 'suppressed') {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: send.error ?? 'sms failed' })
        .eq('id', en.id);
      void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'send_sms', status: 'failed', error_text: send.error ?? 'sms failed' });
      return 'failed';
    }
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'send_sms', status: send.error === 'suppressed' ? 'skipped' : 'success' });
    if (send.ok && send.mergedBody) {
      void findOrCreateThreadForLead(en.venue_id, en.lead_id).then((threadId) => {
        if (threadId) void logToConversationThread({ threadId, venueId: en.venue_id, channel: 'sms', body: send.mergedBody! });
      });
    }
    const nextIdx = idx + 1;
    if (nextIdx >= sorted.length) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() })
        .eq('id', en.id);
      return 'completed';
    }
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ current_step_index: nextIdx, next_run_at: new Date().toISOString() })
      .eq('id', en.id);
    return 'advanced';
  }
  // ── add_tag: apply one or more tags to the enrolled contact ─────────────
  if (step.step_type === 'add_tag') {
    const cfg = step.config_json as { tag_ids?: string[] };
    const tagIds = (cfg.tag_ids ?? []).filter(Boolean);
    if (tagIds.length > 0) {
      const rows = tagIds.map((tagId) => ({ lead_id: en.lead_id, tag_id: tagId }));
      await supabaseAdmin.from('lead_tag_assignments').upsert(rows, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true });
    }
    const nextIdx = idx + 1;
    const done = nextIdx >= sorted.length;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      done ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
           : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'add_tag', status: 'success' });
    return done ? 'completed' : 'advanced';
  }

  if (step.step_type === 'remove_tag') {
    const cfg = step.config_json as { tag_ids?: string[] };
    const tagIds = (cfg.tag_ids ?? []).filter(Boolean);
    if (tagIds.length > 0) {
      await supabaseAdmin.from('lead_tag_assignments').delete().eq('lead_id', en.lead_id).in('tag_id', tagIds);
    }
    const nextIdx = idx + 1;
    const done = nextIdx >= sorted.length;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      done ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
           : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'remove_tag', status: 'success' });
    return done ? 'completed' : 'advanced';
  }

  if (step.step_type === 'change_stage') {
    const cfg = step.config_json as { stage_id?: string };
    const stageId = String(cfg.stage_id || '').trim();
    if (stageId) {
      await supabaseAdmin.from('leads').update({ stage_id: stageId }).eq('id', en.lead_id);
    }
    const nextIdx = idx + 1;
    const done = nextIdx >= sorted.length;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      done ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
           : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'change_stage', status: 'success' });
    return done ? 'completed' : 'advanced';
  }

  // ── notify_owner: send email and/or SMS to the venue owner ───────────────
  if (step.step_type === 'notify_owner') {
    const cfg = step.config_json as { channel?: 'email' | 'sms' | 'both'; subject?: string; body?: string };
    const channel = cfg.channel ?? 'email';
    const rawSubject = String(cfg.subject ?? '').trim();
    const rawBody    = String(cfg.body ?? '').trim();
    if (!rawBody && channel !== 'email') {
      void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'notify_owner', status: 'failed', error_text: 'empty_body' });
      const nextIdx = idx + 1;
      await supabaseAdmin.from('marketing_automation_enrollments').update({ current_step_index: nextIdx, next_run_at: new Date().toISOString() }).eq('id', en.id);
      return 'advanced';
    }

    // Load venue + lead for merge variables
    const [{ data: venue }, { data: autoRow }] = await Promise.all([
      supabaseAdmin
        .from('venues')
        .select('email,name,owner_first_name,owner_last_name,notification_phone,ghl_access_token,ghl_location_id,ghl_connected,location_full,location_city,location_state,brand_website')
        .eq('id', en.venue_id)
        .maybeSingle(),
      supabaseAdmin
        .from('marketing_automations')
        .select('name')
        .eq('id', en.automation_id)
        .maybeSingle(),
    ]);
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
    const vars = await buildMergeVars(en.venue_id, en.lead_id, appOrigin, { forSms: channel === 'sms' });
    const workflowName = (autoRow as { name?: string } | null)?.name?.trim() || 'a workflow';
    const ownerVars: MergeFieldRecord = {
      ...(vars ?? {}),
      'system.workflow_name': workflowName,
      'venue.email':          (venue?.email as string | null) || '',
      'venue.phone':          (venue?.notification_phone as string | null) || '',
    };
    const subject = rawSubject ? mergeMarketingFields(rawSubject, ownerVars) : `Workflow update: ${workflowName}`;
    const body    = rawBody    ? mergeMarketingFields(rawBody,    ownerVars) : `${workflowName} fired for a contact.`;

    let emailOk = true;
    let smsOk   = true;
    let skipped = '';

    // Email branch
    if ((channel === 'email' || channel === 'both')) {
      const ownerEmail = (venue?.email as string | null)?.trim();
      if (!ownerEmail) {
        emailOk = channel === 'email' ? false : true; // for 'both' allow SMS to still try
        skipped = ownerEmail ? skipped : 'no_owner_email';
      } else {
        try {
          const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111;white-space:pre-wrap;">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
          await sendEmail({ to: ownerEmail, subject, html });
        } catch (e) {
          emailOk = false;
          console.error('[worker] notify_owner email failed:', e);
        }
      }
    }

    // SMS branch — only via GHL (legacy messaging) for now
    if ((channel === 'sms' || channel === 'both')) {
      const ownerPhone = (venue?.notification_phone as string | null)?.trim();
      const ghlToken = getGhlToken({ ghl_access_token: (venue?.ghl_access_token as string | null) ?? null });
      const locId    = (venue?.ghl_location_id as string | null) || '';
      if (!ownerPhone || !ghlToken || !locId) {
        smsOk = channel === 'sms' ? false : true;
        if (!ownerPhone) skipped = 'no_owner_phone';
        else if (!ghlToken || !locId) skipped = 'legacy_messaging_not_connected';
      } else {
        try {
          const norm = normalizePhone(ownerPhone) || ownerPhone;
          const ownerEmail = (venue?.email as string | null) || undefined;
          const contact = await findOrCreateContact(ghlToken, locId, { phone: norm, email: ownerEmail, firstName: 'Owner' }).catch(() => null);
          const contactId = (contact as { id?: string } | null)?.id;
          if (contactId) {
            await sendSms(ghlToken, locId, contactId, body);
          } else {
            smsOk = channel === 'sms' ? false : true;
            skipped = skipped || 'could_not_resolve_owner_contact';
          }
        } catch (e) {
          smsOk = false;
          console.error('[worker] notify_owner SMS failed:', e);
        }
      }
    }

    const allOk    = emailOk && smsOk;
    const anyOk    = emailOk || smsOk;
    const status: 'success' | 'failed' | 'skipped' = allOk ? 'success' : (anyOk ? 'success' : 'skipped');
    void logStepExecution({
      automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id,
      step_order: idx, step_type: 'notify_owner', status,
      error_text: status === 'success' ? undefined : (skipped || 'send_failed'),
    });

    const nextIdx = idx + 1;
    const done = nextIdx >= sorted.length;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      done ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
           : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    return done ? 'completed' : 'advanced';
  }

  // ── create_conversation: open/find a conversation thread and stamp it ─────
  if (step.step_type === 'create_conversation') {
    // Fetch the workflow name for the system message
    const { data: autoRow } = await supabaseAdmin
      .from('marketing_automations')
      .select('name')
      .eq('id', en.automation_id)
      .maybeSingle();
    const workflowName = (autoRow as { name?: string } | null)?.name?.trim() || 'a workflow';

    const threadId = await findOrCreateThreadForLead(en.venue_id, en.lead_id);
    if (threadId) {
      const now = new Date();
      const ts = now.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      await logToConversationThread({
        threadId,
        venueId: en.venue_id,
        channel: 'sms',
        body: `[System] Lead entered workflow "${workflowName}" on ${ts}`,
      });
    }
    const nextIdx = idx + 1;
    const done = nextIdx >= sorted.length;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      done ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
           : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    void logStepExecution({ automation_id: en.automation_id, enrollment_id: en.id, venue_id: en.venue_id, lead_id: en.lead_id, step_order: idx, step_type: 'create_conversation', status: threadId ? 'success' : 'skipped', error_text: threadId ? undefined : 'no_email_on_lead' });
    return done ? 'completed' : 'advanced';
  }

  return 'unknown';
}

/**
 * Run an enrollment through as many consecutive steps as possible without
 * pausing. Stops at a delay step (schedules future run), completion, failure,
 * or an unknown step type. Cap at 50 steps to prevent infinite loops.
 */
async function processEnrollmentChain(
  en: { id: string; automation_id: string; venue_id: string; lead_id: string; current_step_index: number },
  maxSteps = 50,
): Promise<StepResult> {
  let state = en;
  for (let i = 0; i < maxSteps; i++) {
    const result = await processOneEnrollment(state);
    if (result !== 'advanced') return result;
    // Reload state so next iteration uses the updated current_step_index.
    const { data } = await supabaseAdmin
      .from('marketing_automation_enrollments')
      .select('id, automation_id, venue_id, lead_id, current_step_index, status')
      .eq('id', en.id)
      .maybeSingle();
    if (!data || (data.status as string) !== 'active') return result;
    state = data as typeof en;
  }
  return 'advanced';
}

export async function processCampaignsCron(): Promise<{ campaigns: number; recipients: number }> {
  const now = new Date().toISOString();
  let sent = 0;

  const { data: toStart } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('id, venue_id, template_id, name')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(5);
  for (const c of toStart ?? []) {
    await supabaseAdmin
      .from('marketing_campaigns')
      .update({ status: 'sending', started_at: now })
      .eq('id', (c as { id: string }).id);
    const camp = c as { id: string; venue_id: string; template_id: string };
    const { data: campRow } = await supabaseAdmin
      .from('marketing_campaigns')
      .select('segment_json')
      .eq('id', camp.id)
      .single();
    const segment = parseSegment(campRow?.segment_json);
    const recips = await resolveCampaignRecipients(camp.venue_id, segment);
    if (recips.length === 0) {
      await supabaseAdmin
        .from('marketing_campaigns')
        .update({ status: 'sent', completed_at: now, last_error: null })
        .eq('id', camp.id);
      continue;
    }
    const rows = recips.map((r) => ({
      campaign_id: camp.id,
      venue_id: camp.venue_id,
      lead_id: r.id,
      email: r.email,
      status: 'queued',
    }));
    await supabaseAdmin.from('marketing_campaign_recipients').insert(rows);
  }

  const { data: queued } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id, campaign_id, venue_id, lead_id, email')
    .eq('status', 'queued')
    .limit(BATCH);
  const campaignIds = [...new Set((queued ?? []).map((q: { campaign_id: string }) => q.campaign_id))];
  const { data: tmplCache } =
    campaignIds.length > 0
      ? await supabaseAdmin
          .from('marketing_campaigns')
          .select('id, template_id, venue_id')
          .in('id', campaignIds)
      : { data: [] as { id: string; template_id: string; venue_id: string }[] };
  const templateByCampaign = new Map<string, string>();
  const venueByCampaign = new Map<string, string>();
  for (const c of tmplCache ?? []) {
    templateByCampaign.set((c as { id: string }).id, (c as { template_id: string }).template_id);
    venueByCampaign.set((c as { id: string }).id, (c as { venue_id: string }).venue_id);
  }

  for (const r of queued ?? []) {
    const row = r as { id: string; campaign_id: string; venue_id: string; lead_id: string; email: string };
    const templateId = templateByCampaign.get(row.campaign_id);
    if (!templateId) continue;
    const { data: tmpl } = await supabaseAdmin
      .from('marketing_email_templates')
      .select('subject, preheader, definition_json')
      .eq('id', templateId)
      .eq('venue_id', row.venue_id)
      .maybeSingle();
    if (!tmpl) {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'failed', error: 'template missing' })
        .eq('id', row.id);
      continue;
    }
    const def = parseEmailDefinition(tmpl.definition_json);
    const send = await sendTemplateToLead(row.venue_id, row.lead_id, def, tmpl.subject as string, tmpl.preheader as string, {
      campaignRecipientId: row.id,
    });
    if (send.ok) {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sent++;
    } else if (send.error === 'suppressed') {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'skipped_unsub' })
        .eq('id', row.id);
    } else {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'failed', error: send.error ?? 'send' })
        .eq('id', row.id);
    }
  }

  const { data: sending } = await supabaseAdmin.from('marketing_campaigns').select('id').eq('status', 'sending');
  for (const c of sending ?? []) {
    const id = (c as { id: string }).id;
    const { count } = await supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'queued');
    if ((count ?? 0) === 0) {
      await supabaseAdmin
        .from('marketing_campaigns')
        .update({ status: 'sent', completed_at: new Date().toISOString() })
        .eq('id', id);
    }
  }

  return { campaigns: (toStart ?? []).length, recipients: sent };
}

export async function runMarketingEmailCron(): Promise<Record<string, number | string>> {
  const w = await processWeddingDateFollowupAutomations();
  const a = await processAutomationEnrollmentsBatch();
  const c = await processCampaignsCron();
  return {
    weddingFollowupEnrollments: w.enrolled,
    automationSteps: a.processed,
    campaignRecipientsSent: c.recipients,
    campaignsStarted: c.campaigns,
  };
}
