import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads/[id]/marketing-activity
 *
 * Trigger link clicks and page views for this lead (newest first).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId } = await context.params;

  const { data: lead, error: e0 } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (e0 || !lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('lead_marketing_events')
    .select(
      `
      id,
      event_type,
      page_path,
      page_title,
      referrer,
      created_at,
      trigger_link_id,
      trigger_links ( name, short_code, target_url )
    `,
    )
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
