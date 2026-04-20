import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('couple_saved_venues')
    .delete()
    .eq('couple_id', user.id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[couple/wishlist DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
