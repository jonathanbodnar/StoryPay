import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Remove a push subscription. The client should call this:
 *   - When the user toggles push off in Settings → Notifications, and
 *   - After calling `subscription.unsubscribe()` on the browser side.
 *
 * Keyed on the `endpoint` URL (globally unique). Scoped to the signed-in
 * venue so one tenant cannot delete another tenant's subscriptions even
 * if they guessed an endpoint.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const endpoint = (body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[push unsubscribe] delete failed:', error.message);
    return NextResponse.json({ error: 'Failed to remove subscription.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
