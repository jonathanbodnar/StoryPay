import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FORM_BREAKDOWN_CAP = 10_000;

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const since7d = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const [
    sentRes,
    openedRes,
    templateRes,
    campaignRes,
    automationRes,
    activeAutomationRes,
    formRes,
    totalFormSubmissionsRes,
    formSubmissions7dRes,
    triggerLinkClicksRes,
    suppressionRes,
    formRowsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('status', 'sent'),
    supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('status', 'sent')
      .not('opened_at', 'is', null),
    supabaseAdmin
      .from('marketing_email_templates')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_automations')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_automations')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('status', 'active'),
    supabaseAdmin
      .from('marketing_forms')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .gte('created_at', since7d),
    supabaseAdmin
      .from('lead_marketing_events')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('event_type', 'trigger_link_click'),
    supabaseAdmin
      .from('marketing_email_suppressions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_form_submissions')
      .select('form_id')
      .eq('venue_id', venueId)
      .limit(FORM_BREAKDOWN_CAP),
  ]);

  const counts: Record<string, number> = {};
  for (const r of formRowsRes.data ?? []) {
    const fid = (r as { form_id: string }).form_id;
    counts[fid] = (counts[fid] ?? 0) + 1;
  }
  const formIds = Object.keys(counts);
  const names = new Map<string, string>();
  if (formIds.length > 0) {
    const { data: forms } = await supabaseAdmin.from('marketing_forms').select('id, name').in('id', formIds);
    for (const f of forms ?? []) names.set((f as { id: string }).id, (f as { name: string }).name);
  }
  const formSubmissions = formIds
    .map((formId) => ({
      formId,
      name: names.get(formId) || 'Form',
      count: counts[formId] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const totalSubs = totalFormSubmissionsRes.count ?? 0;
  const breakdownSum = formSubmissions.reduce((s, x) => s + x.count, 0);
  const breakdownTruncated = breakdownSum < totalSubs;

  return NextResponse.json({
    emailsSent: sentRes.count ?? 0,
    emailsOpened: openedRes.count ?? 0,
    formSubmissions,
    templateCount: templateRes.count ?? 0,
    campaignCount: campaignRes.count ?? 0,
    automationCount: automationRes.count ?? 0,
    activeAutomationCount: activeAutomationRes.count ?? 0,
    formCount: formRes.count ?? 0,
    totalFormSubmissions: totalSubs,
    formSubmissionsLast7Days: formSubmissions7dRes.count ?? 0,
    triggerLinkClicksTracked: triggerLinkClicksRes.count ?? 0,
    suppressionCount: suppressionRes.count ?? 0,
    formBreakdownTruncated: breakdownTruncated,
  });
}
