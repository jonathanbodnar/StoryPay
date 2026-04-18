import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId() {
  const { cookies } = await import('next/headers');
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

type Item = {
  id: string;
  kind: string;
  title: string;
  detail?: string | null;
  created_at: string;
};

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

  const [notesRes, eventsRes, sendsRes, tasksRes] = await Promise.all([
    supabaseAdmin
      .from('lead_notes')
      .select('id, content, created_at, author_name')
      .eq('lead_id', leadId)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('lead_marketing_events')
      .select(
        'id, event_type, created_at, page_path, trigger_links(name, short_code)',
      )
      .eq('lead_id', leadId)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('id, campaign_id, sent_at, status')
      .eq('lead_id', leadId)
      .eq('venue_id', venueId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('lead_tasks')
      .select('id, title, due_at, completed_at, created_at')
      .eq('lead_id', leadId)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const items: Item[] = [];

  for (const n of notesRes.data ?? []) {
    const row = n as { id: string; content: string; created_at: string; author_name: string | null };
    items.push({
      id: `note-${row.id}`,
      kind: 'note',
      title: 'Note',
      detail: row.content,
      created_at: row.created_at,
    });
  }

  for (const e of eventsRes.data ?? []) {
    const row = e as {
      id: string;
      event_type: string;
      created_at: string;
      page_path: string | null;
      trigger_links: { name?: string; short_code?: string } | null;
    };
    const tl = row.trigger_links;
    const name = tl && !Array.isArray(tl) ? tl.name : null;
    items.push({
      id: `evt-${row.id}`,
      kind: row.event_type,
      title:
        row.event_type === 'trigger_link_click' ?
          `Link click${name ? `: ${name}` : ''}`
        : row.event_type,
      detail: row.page_path ?? null,
      created_at: row.created_at,
    });
  }

  const campaignIds = [...new Set((sendsRes.data ?? []).map((x) => (x as { campaign_id: string }).campaign_id))];
  const campNames = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await supabaseAdmin
      .from('marketing_campaigns')
      .select('id, name')
      .in('id', campaignIds);
    for (const c of camps ?? []) {
      campNames.set((c as { id: string }).id, (c as { name: string }).name);
    }
  }

  for (const s of sendsRes.data ?? []) {
    const row = s as { id: string; campaign_id: string; sent_at: string | null; status: string };
    const cname = campNames.get(row.campaign_id);
    items.push({
      id: `email-${row.id}`,
      kind: 'marketing_email',
      title: `Campaign email: ${cname || 'Campaign'}`,
      detail: row.status === 'sent' ? 'Sent' : row.status,
      created_at: row.sent_at || new Date().toISOString(),
    });
  }

  for (const t of tasksRes.data ?? []) {
    const row = t as { id: string; title: string; created_at: string; completed_at: string | null };
    items.push({
      id: `task-${row.id}`,
      kind: 'task',
      title: row.completed_at ? `Task done: ${row.title}` : `Task: ${row.title}`,
      created_at: row.created_at,
    });
  }

  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ items });
}
