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

const BATCH = 25;

async function enrollIfNew(automationId: string, venueId: string, leadId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('marketing_automation_enrollments').insert({
    automation_id: automationId,
    venue_id: venueId,
    lead_id: leadId,
    current_step_index: 0,
    status: 'active',
    next_run_at: new Date().toISOString(),
  });
  if (error?.code === '23505') return;
  if (error) console.error('[marketing enroll]', error);
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
    if (matched) await enrollIfNew(row.id, venueId, leadId);
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
    .select('name, location_full, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, email, first_name, last_name, name, wedding_date, guest_count, marketing_email_opt_in, sms_dnd')
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
  return {
    first_name: fn,
    last_name: ln,
    email,
    venue_name: (venue?.name as string) || 'Your venue',
    venue_full_address: fullAddr,
    venue_city: (venue?.location_city as string) || '',
    venue_state: (venue?.location_state as string) || '',
    unsubscribe_url: unsub,
    resubscribe_url: resub,
    preferences_url: prefs,
    wedding_date: wd || '',
    wedding_date_nice: wedding_date_nice || '',
    wedding_month: wedding_month || '',
    guest_count: gc != null ? String(gc) : '',
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

async function sendAutomationSmsToLead(
  venueId: string,
  leadId: string,
  bodyTemplate: string,
  mediaUrls?: string[],
): Promise<{ ok: boolean; error?: string }> {
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
  if (!(venue as { ghl_connected?: boolean } | null)?.ghl_connected) {
    return { ok: false, error: 'ghl_not_connected' };
  }
  const token = getGhlToken(venue as { ghl_access_token?: string | null });
  const loc = venue?.ghl_location_id as string | null;
  if (!token || !loc) return { ok: false, error: 'ghl_not_configured' };
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
  return { ok: true };
}

async function sendTemplateToLead(
  venueId: string,
  leadId: string,
  definition: MarketingEmailDefinition,
  subject: string,
  preheader: string,
  opts?: { campaignRecipientId?: string },
): Promise<{ ok: boolean; error?: string }> {
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
  const fromName = `${(venue?.name as string) || 'Venue'} via StoryPay`;
  const r = await sendEmail({
    to: vars.email,
    subject: mergedSubject,
    html: fullHtml,
    from: { name: fromName },
  });
  return r.success ? { ok: true } : { ok: false, error: r.error };
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
    const ok = await processOneEnrollment(en as {
      id: string;
      automation_id: string;
      venue_id: string;
      lead_id: string;
      current_step_index: number;
    });
    if (ok) n++;
  }
  return { processed: n };
}

async function processOneEnrollment(en: {
  id: string;
  automation_id: string;
  venue_id: string;
  lead_id: string;
  current_step_index: number;
}): Promise<boolean> {
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
    return true;
  }
  const sorted = [...steps].sort((a, b) => (a.step_order as number) - (b.step_order as number));
  const idx = en.current_step_index;
  if (idx >= sorted.length) {
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() })
      .eq('id', en.id);
    return true;
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
    return true;
  }
  if (step.step_type === 'send_email') {
    const templateId = String((step.config_json as { template_id?: string }).template_id || '');
    if (!templateId) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: 'Missing template_id' })
        .eq('id', en.id);
      return true;
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
      return true;
    }
    const def = parseEmailDefinition(tmpl.definition_json);
    const send = await sendTemplateToLead(en.venue_id, en.lead_id, def, tmpl.subject as string, tmpl.preheader as string, undefined);
    if (!send.ok && send.error !== 'suppressed') {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: send.error ?? 'send failed' })
        .eq('id', en.id);
      return true;
    }
    const nextIdx = idx + 1;
    if (nextIdx >= sorted.length) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({
          status: 'completed',
          current_step_index: nextIdx,
          completed_at: new Date().toISOString(),
          next_run_at: new Date().toISOString(),
        })
        .eq('id', en.id);
    } else {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({
          current_step_index: nextIdx,
          next_run_at: new Date().toISOString(),
        })
        .eq('id', en.id);
    }
    return true;
  }
  if (step.step_type === 'send_sms') {
    const cfg = step.config_json as { body?: string; media_urls?: string[] };
    const body = String(cfg.body || '').trim();
    if (!body) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: 'Empty SMS body' })
        .eq('id', en.id);
      return true;
    }
    const send = await sendAutomationSmsToLead(en.venue_id, en.lead_id, body, cfg.media_urls);
    if (!send.ok && send.error !== 'suppressed') {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({ status: 'failed', last_error: send.error ?? 'sms failed' })
        .eq('id', en.id);
      return true;
    }
    const nextIdx = idx + 1;
    if (nextIdx >= sorted.length) {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({
          status: 'completed',
          current_step_index: nextIdx,
          completed_at: new Date().toISOString(),
          next_run_at: new Date().toISOString(),
        })
        .eq('id', en.id);
    } else {
      await supabaseAdmin
        .from('marketing_automation_enrollments')
        .update({
          current_step_index: nextIdx,
          next_run_at: new Date().toISOString(),
        })
        .eq('id', en.id);
    }
    return true;
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
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      nextIdx >= sorted.length
        ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
        : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    return true;
  }

  // ── remove_tag: detach one or more tags from the enrolled contact ────────
  if (step.step_type === 'remove_tag') {
    const cfg = step.config_json as { tag_ids?: string[] };
    const tagIds = (cfg.tag_ids ?? []).filter(Boolean);
    if (tagIds.length > 0) {
      await supabaseAdmin
        .from('lead_tag_assignments')
        .delete()
        .eq('lead_id', en.lead_id)
        .in('tag_id', tagIds);
    }
    const nextIdx = idx + 1;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      nextIdx >= sorted.length
        ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
        : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    return true;
  }

  // ── change_stage: move the lead to a different pipeline stage ───────────
  if (step.step_type === 'change_stage') {
    const cfg = step.config_json as { stage_id?: string };
    const stageId = String(cfg.stage_id || '').trim();
    if (stageId) {
      await supabaseAdmin.from('leads').update({ stage_id: stageId }).eq('id', en.lead_id);
    }
    const nextIdx = idx + 1;
    await supabaseAdmin.from('marketing_automation_enrollments').update(
      nextIdx >= sorted.length
        ? { status: 'completed', current_step_index: nextIdx, completed_at: new Date().toISOString(), next_run_at: new Date().toISOString() }
        : { current_step_index: nextIdx, next_run_at: new Date().toISOString() },
    ).eq('id', en.id);
    return true;
  }

  return false;
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
