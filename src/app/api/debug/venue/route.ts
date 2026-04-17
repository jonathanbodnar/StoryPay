import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, is_published, cover_image_url, gallery_images, description, created_at, updated_at')
    .eq('id', venueId)
    .maybeSingle();

  return NextResponse.json({ venue: data, error: error?.message ?? null });
}
