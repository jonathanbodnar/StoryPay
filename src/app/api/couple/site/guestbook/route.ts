import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — all guestbook entries for the bride's site (including hidden). */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('couple_guestbook_entries')
    .select('id, guest_name, message, is_hidden, created_at')
    .eq('couple_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500);

  return NextResponse.json({ entries: data ?? [] });
}
