import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Record a page view for a lead (e.g. from your public site / listing embed).
 * Verifies the lead exists; use only on pages where the lead id is already known
 * (e.g. magic-link flows). Optional hardening: add a signed token later.
 */
export async function POST(request: NextRequest) {
  let body: { leadId?: string; path?: string; title?: string | null; referrer?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!leadId || !path) {
    return NextResponse.json({ error: 'leadId and path are required' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.slice(0, 500) : null;
  const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 2000) : null;
  const ua = request.headers.get('user-agent');

  const { data: lead, error: le } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id')
    .eq('id', leadId)
    .maybeSingle();

  if (le || !lead) {
    return NextResponse.json({ error: 'Unknown lead' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('lead_marketing_events').insert({
    venue_id: lead.venue_id,
    lead_id: lead.id,
    event_type: 'page_view',
    trigger_link_id: null,
    page_path: path.slice(0, 4000),
    page_title: title,
    referrer,
    user_agent: ua,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const res = NextResponse.json({ ok: true });
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
