import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  parseDefinition,
  serializeDefinition,
  type MarketingFormDefinition,
} from '@/lib/marketing-form-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('marketing_forms')
    .select('id, name, embed_token, published, definition_json, created_at, updated_at')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    form: {
      ...data,
      definition: parseDefinition(data.definition_json),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body: { name?: string; published?: boolean; definition?: MarketingFormDefinition };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.published === 'boolean') patch.published = body.published;
  if (body.definition) {
    patch.definition_json = serializeDefinition(body.definition);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('marketing_forms')
    .update(patch)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, name, embed_token, published, definition_json, created_at, updated_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    form: {
      ...data,
      definition: parseDefinition(data.definition_json),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data: deleted, error } = await supabaseAdmin
    .from('marketing_forms')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
