import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendPushToVenue } from '@/lib/push';

/**
 * Send a test push to every registered device for the signed-in venue.
 * Surfaced behind a "Send test" button in Settings → Notifications so
 * users can confirm the SW + permission grant + VAPID config end-to-end.
 *
 * Returns the delivery summary { sent, pruned, failed } so the UI can show
 * a confirmation toast with the real device count.
 */
export async function POST() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendPushToVenue(venueId, {
    title: 'StoryVenue test notification',
    body:  'Push notifications are working on this device.',
    url:   '/dashboard/settings/notifications',
    tag:   'storyvenue-test',
  });

  return NextResponse.json(result);
}
