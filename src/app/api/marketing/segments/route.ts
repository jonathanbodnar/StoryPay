import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { parseSavedSegmentDefinition } from '@/lib/marketing-email-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SegmentRow {
  id: string;
  name: string;
  description: string;
  definition_json: unknown;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .select('id, name, description, definition_json, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segments: (data ?? []) as SegmentRow[] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; description?: string; definition?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'Name is too long (max 200)' }, { status: 400 });

  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  const definition = parseSavedSegmentDefinition(body.definition);

  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .insert({
      venue_id: venueId,
      name,
      description,
      definition_json: definition,
    })
    .select('id, name, description, definition_json, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A segment with that name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ segment: data });
}
