import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import {
  parseEmailDefinition,
  parseSegment,
  type MarketingEmailDefinition,
} from '@/lib/marketing-email-schema';
import { mergeMarketingFields, renderMarketingEmailHtml, type MergeFieldRecord } from '@/lib/marketing-email-render';
import { resolveCampaignRecipients } from '@/lib/marketing-email-audience';
import { signMarketingOpenToken, signMarketingUnsubscribeToken } from '@/lib/marketing-email-tokens';

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

export async function onMarketingTagAdded(
  venueId: string,
  leadId: string,
  addedTagIds: string[],
): Promise<void> {
  if (!addedTagIds.length) return;
  const { data: autos } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, trigger_config')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .eq('trigger_type', 'tag_added');
  for (const row of autos ?? []) {
    const cfg = (row.trigger_config || {}) as { tag_ids?: string[] };
    const want = cfg.tag_ids?.filter(Boolean) ?? [];
    const match =
      want.length === 0 ? addedTagIds.length > 0 : addedTagIds.some((t) => want.includes(t));
    if (!match) continue;
    await enrollIfNew(row.id as string, venueId, leadId);
  }
}

export async function onMarketingStageChanged(
  venueId: string,
  leadId: string,
  newStageId: string | null,
): Promise<void> {
  if (!newStageId) return;
  const { data: autos } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, trigger_config')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .eq('trigger_type', 'stage_changed');
  for (const row of autos ?? []) {
    const cfg = (row.trigger_config || {}) as { to_stage_ids?: string[] };
    const stages = cfg.to_stage_ids?.filter(Boolean) ?? [];
    if (!stages.length || !stages.includes(newStageId)) continue;
    await enrollIfNew(row.id as string, venueId, leadId);
  }
}

export async function onMarketingTriggerLinkClick(
  venueId: string,
  leadId: string | null,
  triggerLinkId: string,
): Promise<void> {
  if (!leadId) return;
  const { data: autos } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, trigger_config')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .eq('trigger_type', 'trigger_link_click');
  for (const row of autos ?? []) {
    const cfg = (row.trigger_config || {}) as { trigger_link_ids?: string[] };
    const links = cfg.trigger_link_ids?.filter(Boolean) ?? [];
    if (!links.length || !links.includes(triggerLinkId)) continue;
    await enrollIfNew(row.id as string, venueId, leadId);
  }
}

export async function buildMergeVars(
  venueId: string,
  leadId: string,
  appOrigin: string,
): Promise<MergeFieldRecord | null> {
  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, email, first_name, last_name, name, wedding_date, guest_count')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead?.email) return null;
  const fn = (lead.first_name as string | null)?.trim() || (lead.name as string | null)?.split(/\s+/)[0] || 'there';
  const ln = (lead.last_name as string | null)?.trim() || '';
  const token = signMarketingUnsubscribeToken(venueId, leadId);
  const unsub = `${appOrigin.replace(/\/$/, '')}/api/public/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
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
  return {
    first_name: fn,
    last_name: ln,
    email: String(lead.email),
    venue_name: (venue?.name as string) || 'Your venue',
    unsubscribe_url: unsub,
    wedding_date: wd || '',
    wedding_date_nice: wedding_date_nice || '',
    wedding_month: wedding_month || '',
    guest_count: gc != null ? String(gc) : '',
  };
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
  if (!vars?.email) return { ok: false, error: 'No email' };
  const { data: sup } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .maybeSingle();
  if (sup) return { ok: false, error: 'suppressed' };
  let html = renderMarketingEmailHtml(definition, vars);
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
  const a = await processAutomationEnrollmentsBatch();
  const c = await processCampaignsCron();
  return { automationSteps: a.processed, campaignRecipientsSent: c.recipients, campaignsStarted: c.campaigns };
}
