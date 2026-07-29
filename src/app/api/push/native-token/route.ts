import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Register / unregister a NATIVE push device token (APNs on iOS, FCM on
 * Android) for the signed-in venue/member. This is the native-shell
 * counterpart to /api/push/subscribe (web-push).
 *
 * POST  { token: string, platform: 'ios' | 'android' }
 *   Upserts on `token` so re-registering the same device just refreshes
 *   updated_at / venue / member rather than creating duplicate rows.
 *
 * DELETE { token: string }   (called on logout)
 *   Removes the token so a signed-out device stops receiving pushes.
 *
 * Auth: cookie `venue_id` is required (same session model as the rest of the
 * dashboard). Optional `member_id` ties the token to a team member.
 */

type Platform = 'ios' | 'android';

function isPlatform(v: unknown): v is Platform {
  return v === 'ios' || v === 'android';
}

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

  const { token, platform } = (body ?? {}) as { token?: unknown; platform?: unknown };
  const tokenStr = typeof token === 'string' ? token.trim() : '';

  if (!tokenStr || !isPlatform(platform)) {
    return NextResponse.json(
      { error: 'Invalid payload — token (string) and platform (ios|android) are required.' },
      { status: 400 },
    );
  }
  // APNs/FCM tokens are well under 512 chars; cap defensively.
  if (tokenStr.length > 512) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('device_tokens')
    .upsert(
      {
        venue_id:   venueId,
        member_id:  memberId,
        token:      tokenStr,
        platform,
        updated_at: now,
      },
      { onConflict: 'token' },
    );

  if (error) {
    console.error('[native-token] upsert failed:', error.message);
    return NextResponse.json({ error: 'Failed to save device token.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
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

  const { token } = (body ?? {}) as { token?: unknown };
  const tokenStr = typeof token === 'string' ? token.trim() : '';
  if (!tokenStr) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 });
  }

  // Scope the delete to this venue so a token can only be removed by a session
  // that owns it.
  const { error } = await supabaseAdmin
    .from('device_tokens')
    .delete()
    .eq('token', tokenStr)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[native-token] delete failed:', error.message);
    return NextResponse.json({ error: 'Failed to remove device token.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
