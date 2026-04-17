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
 * GET /api/leads/[id]/notes
 *
 * List every note attached to a lead, newest first. Each note has its own
 * timestamp — the UI renders them as a threaded activity feed in the lead
 * detail drawer.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .select('id, lead_id, content, author_name, created_at')
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

/**
 * POST /api/leads/[id]/notes
 *   body: { content: string, author_name?: string }
 *
 * Append a timestamped note to a lead. The DB default gives it a
 * server-side `created_at` so the UI always shows a trustworthy timestamp.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId } = await context.params;

  let body: { content?: string; author_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: 'Note content is required' }, { status: 400 });

  // Confirm lead belongs to this venue before inserting so we never attach a
  // note to a lead from someone else's account.
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .insert({
      lead_id:     leadId,
      venue_id:    venueId,
      content,
      author_name: body.author_name?.trim() || null,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
