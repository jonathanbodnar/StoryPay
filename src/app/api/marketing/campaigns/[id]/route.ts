import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import type { CampaignSegment } from '@/lib/marketing-email-schema';
import { parseEmailDefinition } from '@/lib/marketing-email-schema';
import { mergeMarketingFields, renderMarketingEmailHtml, type MergeFieldRecord } from '@/lib/marketing-email-render';
import { sendEmail } from '@/lib/email';
import { buildMergeVars } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { count: sent } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .eq('status', 'sent');
  return NextResponse.json({ campaign: data, stats: { sent: sent ?? 0 } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: {
    name?: string;
    templateId?: string;
    segment?: CampaignSegment;
    action?: 'schedule' | 'send_now' | 'cancel' | 'save_draft';
    scheduledAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: existing, error: exErr } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.action === 'cancel') {
    if (!['draft', 'scheduled'].includes(existing.status as string)) {
      return NextResponse.json({ error: 'Cannot cancel in current status' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaign: data });
  }

  if (body.action === 'schedule') {
    if (!body.scheduledAt) {
      return NextResponse.json({ error: 'scheduledAt required (ISO string)' }, { status: 400 });
    }
    const t = new Date(body.scheduledAt);
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledAt' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .update({
        status: 'scheduled',
        scheduled_at: t.toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('venue_id', venueId)
      .in('status', ['draft', 'scheduled'])
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Campaign not in draft/scheduled' }, { status: 400 });
    return NextResponse.json({ campaign: data });
  }

  if (body.action === 'send_now') {
    const { data, error } = await supabaseAdmin
      .from('marketing_campaigns')
      .update({
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('venue_id', venueId)
      .in('status', ['draft', 'scheduled'])
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Campaign not found or not sendable' }, { status: 400 });
    return NextResponse.json({ campaign: data });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    patch.name = n;
  }
  if (typeof body.templateId === 'string') {
    const { data: tmpl } = await supabaseAdmin
      .from('marketing_email_templates')
      .select('id')
      .eq('id', body.templateId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!tmpl) return NextResponse.json({ error: 'Template not found' }, { status: 400 });
    patch.template_id = body.templateId;
  }
  if (body.segment) patch.segment_json = body.segment;

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .update(patch)
    .eq('id', id)
    .eq('venue_id', venueId)
    .in('status', ['draft', 'scheduled'])
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found or not editable' }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

/** Test send to a single address (merge fields use venue + synthetic lead if leadId omitted). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: { to?: string; leadId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!to) return NextResponse.json({ error: 'to (email) required' }, { status: 400 });

  const { data: camp, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('template_id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error || !camp) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const { data: tmpl } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('subject, preheader, definition_json')
    .eq('id', camp.template_id as string)
    .eq('venue_id', venueId)
    .single();
  if (!tmpl) return NextResponse.json({ error: 'Template missing' }, { status: 400 });

  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).single();
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const previewUnsub = `${appOrigin.replace(/\/$/, '')}/api/public/marketing/unsubscribe?token=preview`;
  let vars: MergeFieldRecord = {
    first_name: 'Alex',
    last_name: 'Preview',
    email: to,
    venue_name: (venue?.name as string) || 'Your venue',
    unsubscribe_url: previewUnsub,
    wedding_date: '',
    wedding_date_nice: '',
    wedding_month: '',
    guest_count: '',
  };
  if (body.leadId) {
    const merged = await buildMergeVars(venueId, body.leadId, appOrigin);
    if (merged) vars = merged;
  }

  const def = parseEmailDefinition(tmpl.definition_json);
  const html = renderMarketingEmailHtml(def, vars);
  const subject = mergeMarketingFields(tmpl.subject as string, vars);
  const pre = mergeMarketingFields((tmpl.preheader as string) || '', vars);
  const fullHtml = pre.trim()
    ? `<!-- preheader: ${pre.replace(/<!--/g, '').slice(0, 200)} -->\n${html}`
    : html;
  const fromName = `${(venue?.name as string) || 'Venue'} via StoryPay`;
  const r = await sendEmail({ to, subject, html: fullHtml, from: { name: `${fromName} (preview)` } });
  if (!r.success) return NextResponse.json({ error: r.error ?? 'Send failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
