/**
 * POST /api/admin/push/test-native
 *
 * Super-admin-only diagnostic: fire a real native push (APNs / FCM, via
 * src/lib/native-push.ts) at every device token registered for a venue.
 * Built to verify end-to-end delivery on a freshly-registered device (e.g. an
 * Android emulator with no other way to trigger a real inbound event) before
 * shipping a native build to the App Store / Play Store.
 *
 * Body: { venueId: string, title?: string, body?: string }
 * Auth: master admin only (admin_token cookie) — this pings a real device.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';
import { sendNativePush, isNativePushConfigured } from '@/lib/native-push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { venueId?: string; title?: string; body?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueId = (body.venueId || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  if (!isNativePushConfigured()) {
    return NextResponse.json({ error: 'FCM not configured on this server (missing FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)' }, { status: 422 });
  }

  const result = await sendNativePush(venueId, {
    title: body.title?.trim() || 'StoryVenue test push',
    body:  body.body?.trim()  || 'If you can see this on your phone, native push delivery is working.',
    url:   '/dashboard',
    data:  { test: '1' },
  });

  return NextResponse.json({ ok: true, ...result });
}
