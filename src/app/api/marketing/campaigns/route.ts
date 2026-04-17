import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .select(
      'id, name, template_id, segment_json, status, scheduled_at, started_at, completed_at, last_error, created_at, updated_at',
    )
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { name?: string; templateId?: string; segment?: CampaignSegment };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: 'Template is required' }, { status: 400 });
  const { data: tmpl } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('id')
    .eq('id', templateId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!tmpl) return NextResponse.json({ error: 'Template not found' }, { status: 400 });
  const segment = body.segment ?? { type: 'all_leads' as const };
  const { data, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .insert({
      venue_id: venueId,
      template_id: templateId,
      name,
      segment_json: segment,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
