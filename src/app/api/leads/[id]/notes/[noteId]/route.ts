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
 * PATCH /api/leads/[id]/notes/[noteId]
 *   body: { content: string }
 *
 * Edit an existing note (content only — the timestamp stays the original
 * `created_at` so the conversation history stays honest).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; noteId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId, noteId } = await context.params;

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: 'Note content is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .update({ content })
    .eq('id', noteId)
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  return NextResponse.json({ note: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; noteId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId, noteId } = await context.params;

  const { error } = await supabaseAdmin
    .from('lead_notes')
    .delete()
    .eq('id', noteId)
    .eq('lead_id', leadId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
