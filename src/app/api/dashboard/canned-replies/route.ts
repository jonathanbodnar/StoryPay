/**
 * GET /api/dashboard/canned-replies
 *
 * Read-only list for the venue's conversations composer. Filters to templates
 * with scope='venue' or 'both'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channel = (searchParams.get('channel') || '').trim();

  let query = supabaseAdmin
    .from('support_canned_replies')
    .select('id, title, body, shortcut, category, channels, use_count, updated_at')
    .in('scope', ['venue', 'both'])
    .order('use_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);

  if (channel === 'sms' || channel === 'email') {
    query = query.contains('channels', [channel]);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}
