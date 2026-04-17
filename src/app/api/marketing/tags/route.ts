import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, position, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; icon?: string; color?: string | null; position?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  let icon = typeof body.icon === 'string' ? body.icon.trim().slice(0, 16) : '';
  if (!icon) icon = '🏷️';

  const color = typeof body.color === 'string' ? body.color.trim().slice(0, 32) || null : null;
  const position = typeof body.position === 'number' && Number.isFinite(body.position) ? body.position : 0;

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .insert({
      venue_id: venueId,
      name,
      icon,
      color,
      position,
    })
    .select('id, name, icon, color, position, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}
