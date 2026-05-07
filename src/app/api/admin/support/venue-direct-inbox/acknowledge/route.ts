/**
 * POST /api/admin/support/venue-direct-inbox/acknowledge
 *
 * Records that the concierge has "handled" the venue's last reply on a
 * venue_direct thread, so it no longer shows as "Awaiting reply" in the
 * admin Venue Direct inbox — even if the concierge hasn't sent a message
 * back yet (e.g. they closed the bride reply and considered it done).
 *
 * Stored as a conversation_thread_reads row with reader_ref='vd:concierge'
 * so the venue-direct-inbox endpoint can compare the last venue reply's
 * created_at against this timestamp.
 *
 * Body: { threadId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { threadId?: string };
  try { body = (await req.json()) as { threadId?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { threadId } = body;
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  await supabaseAdmin
    .from('conversation_thread_reads')
    .upsert(
      {
        thread_id:    threadId,
        reader_ref:   'vd:concierge',
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,reader_ref' },
    );

  return NextResponse.json({ ok: true });
}
