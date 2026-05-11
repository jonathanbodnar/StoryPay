import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Save (or refresh) a push subscription for the signed-in venue/member.
 *
 * The client posts the serialized PushSubscription returned by
 * `navigator.serviceWorker.ready.pushManager.subscribe(...)`. We upsert on
 * `endpoint` so re-subscribing the same browser does not create duplicate
 * rows — instead it refreshes `last_seen_at` and clears any stale error.
 *
 * Auth: cookie `venue_id` is required. Optional `member_id` ties the
 * subscription to a team member so per-member preferences can be added
 * later without a schema change.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId  = cookieStore.get('venue_id')?.value;
  const memberId = cookieStore.get('member_id')?.value || null;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sub = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };

  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const p256dh   = typeof sub.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
  const auth     = typeof sub.keys?.auth   === 'string' ? sub.keys.auth   : '';

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: 'Invalid push subscription payload — endpoint, keys.p256dh and keys.auth are all required.' },
      { status: 400 },
    );
  }
  // Defensive cap to keep an attacker from filling the table with a 50 KB
  // endpoint URL. Real endpoints are < 500 chars.
  if (endpoint.length > 2048 || p256dh.length > 256 || auth.length > 256) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(
      {
        venue_id:      venueId,
        member_id:     memberId,
        endpoint,
        p256dh,
        auth,
        user_agent:    userAgent,
        last_seen_at:  now,
        last_error:    null,
        last_error_at: null,
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    console.error('[push subscribe] upsert failed:', error.message);
    return NextResponse.json({ error: 'Failed to save subscription.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
