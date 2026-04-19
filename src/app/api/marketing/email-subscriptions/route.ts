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
 * GET /api/marketing/email-subscriptions
 * Contacts who cannot receive marketing email (unsubscribe and/or opt-out).
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: supRows, error: supErr }, { data: optOutLeads, error: optErr }] = await Promise.all([
    supabaseAdmin
      .from('marketing_email_suppressions')
      .select('lead_id, reason, created_at')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('leads')
      .select('id, email, name')
      .eq('venue_id', venueId)
      .eq('marketing_email_opt_in', false),
  ]);

  if (supErr || optErr) {
    console.error('[email-subscriptions GET]', supErr || optErr);
    return NextResponse.json({ error: (supErr || optErr)!.message }, { status: 500 });
  }

  const suppressedIds = new Set((supRows ?? []).map((r: { lead_id: string }) => r.lead_id));

  const leadInfo = new Map<string, { email: string; name: string | null }>();
  const idList = [
    ...suppressedIds,
    ...((optOutLeads ?? []) as Array<{ id: string }>).map((l) => l.id),
  ].filter((id, i, a) => a.indexOf(id) === i);

  if (idList.length > 0) {
    const { data: allLeads } = await supabaseAdmin
      .from('leads')
      .select('id, email, name')
      .eq('venue_id', venueId)
      .in('id', idList);
    for (const l of allLeads ?? []) {
      const row = l as { id: string; email: string; name: string | null };
      leadInfo.set(row.id, { email: row.email, name: row.name });
    }
  }

  const out: Array<{
    lead_id: string;
    email: string;
    name: string | null;
    reason: string;
    created_at: string | null;
    source: 'unsubscribe' | 'opt_out';
  }> = [];

  for (const r of supRows ?? []) {
    const row = r as { lead_id: string; reason: string; created_at: string };
    const li = leadInfo.get(row.lead_id);
    out.push({
      lead_id: row.lead_id,
      email: li?.email ?? '',
      name: li?.name ?? null,
      reason: row.reason,
      created_at: row.created_at,
      source: 'unsubscribe',
    });
  }

  for (const l of optOutLeads ?? []) {
    const row = l as { id: string; email: string; name: string | null };
    if (suppressedIds.has(row.id)) continue;
    out.push({
      lead_id: row.id,
      email: row.email,
      name: row.name,
      reason: 'opt_out',
      created_at: null,
      source: 'opt_out',
    });
  }

  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return NextResponse.json({ subscriptions: out });
}

/**
 * POST /api/marketing/email-subscriptions
 * body: { leadId: string } — restore marketing email (remove suppression, opt in).
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { leadId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 });

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const { error: delErr } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .delete()
    .eq('venue_id', venueId)
    .eq('lead_id', leadId);
  if (delErr) {
    console.error('[email-subscriptions POST delete]', delErr);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('leads')
    .update({ marketing_email_opt_in: true })
    .eq('id', leadId)
    .eq('venue_id', venueId);
  if (upErr) {
    console.error('[email-subscriptions POST update]', upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
