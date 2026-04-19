import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { parseDefinition } from '@/lib/marketing-form-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: formId } = await params;

  const { data, error } = await supabaseAdmin
    .from('marketing_form_revisions')
    .select('id, definition_json, created_at')
    .eq('form_id', formId)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const revisions = (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    definition: parseDefinition(row.definition_json),
  }));

  return NextResponse.json({ revisions });
}
