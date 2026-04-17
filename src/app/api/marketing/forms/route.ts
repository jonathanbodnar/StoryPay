import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { defaultDefinition, serializeDefinition } from '@/lib/marketing-form-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('marketing_forms')
    .select('id, name, embed_token, published, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ forms: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const definition = serializeDefinition(defaultDefinition());

  const { data, error } = await supabaseAdmin
    .from('marketing_forms')
    .insert({
      venue_id: venueId,
      name,
      definition_json: definition,
      published: false,
    })
    .select('id, name, embed_token, published, definition_json, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}
