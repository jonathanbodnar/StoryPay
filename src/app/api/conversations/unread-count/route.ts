import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const readerRef = conversationReaderRef(user);
  const { data, error } = await supabaseAdmin.rpc('conversation_threads_with_meta', {
    p_venue_id: venueId,
    p_reader_ref: readerRef,
    p_unread_only: false,
    p_limit: 500,
  });

  if (error) {
    console.error('[conversations/unread-count]', error);
    return NextResponse.json({ count: 0 });
  }

  const rows = (data ?? []) as { unread_count?: number | string }[];
  const count = rows.reduce((sum, r) => sum + Number(r.unread_count ?? 0), 0);
  return NextResponse.json({ count });
}
