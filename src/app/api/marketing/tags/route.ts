import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureSystemTagsForVenue } from '@/lib/system-tags';
import { isSystemTagVisible } from '@/lib/system-tag-visibility';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Seed system tags for this venue if they don't exist yet (idempotent, awaited)
  await ensureSystemTagsForVenue(venueId);

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, position, is_system, system_key, category, description, auto_apply_events, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('is_system', { ascending: true })   // custom tags first
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hide background system tags from the venue owner. Only custom tags and the
  // small allow-list of informational system tags (Hot Lead, VIP, etc.) are
  // surfaced anywhere in the SaaS UI. Background tags still exist and still
  // power automations + segmentation under the hood — they're just not shown.
  const visible = (data ?? []).filter((t) => {
    const row = t as { is_system?: boolean | null; system_key?: string | null };
    if (!row.is_system) return true;
    return isSystemTagVisible(row.system_key);
  });

  return NextResponse.json({ tags: visible });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; position?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const position = typeof body.position === 'number' && Number.isFinite(body.position) ? body.position : 0;

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .insert({
      venue_id: venueId,
      name,
      icon: '',
      color: null,
      position,
    })
    .select('id, name, icon, color, position, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}
