/**
 * Web Push delivery helper.
 *
 * Reads VAPID credentials from env, fans out a single send to every
 * registered device for a venue, and prunes dead subscriptions when the
 * push service returns 404 / 410 (Gone). Best-effort by design — every
 * caller is `notifyOwner()` which already runs after-the-fact and must
 * never throw into the user's main request flow.
 *
 * Required env vars (set on Railway):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY   — public half of the VAPID keypair
 *   VAPID_PRIVATE_KEY              — private half (NEVER expose to client)
 *   VAPID_CONTACT_EMAIL            — mailto address for push services to
 *                                    reach you about delivery problems
 *
 * Generate the keypair with:
 *   npx web-push generate-vapid-keys
 *
 * If any required var is unset, sendPushToVenue() logs a warning once and
 * returns silently — push is treated as a soft-feature so missing config
 * never breaks email / SMS notifications.
 */

import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase';

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT = process.env.VAPID_CONTACT_EMAIL || 'clients@storyvenuemarketing.com';

let _configured = false;
let _warned = false;

/**
 * One-shot module setup. Safe to call from request paths — the underlying
 * `webpush.setVapidDetails()` just rewrites in-process state.
 */
function configureOnce(): boolean {
  if (_configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    if (!_warned) {
      console.warn(
        '[push] VAPID keys not set — push notifications disabled. ' +
        'Generate keys with `npx web-push generate-vapid-keys` and add ' +
        'NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY to Railway env.',
      );
      _warned = true;
    }
    return false;
  }
  try {
    const contact = VAPID_CONTACT.startsWith('mailto:')
      ? VAPID_CONTACT
      : `mailto:${VAPID_CONTACT}`;
    webpush.setVapidDetails(contact, VAPID_PUBLIC, VAPID_PRIVATE);
    _configured = true;
    return true;
  } catch (err) {
    console.error('[push] VAPID setup failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}

export function getPublicVapidKey(): string | null {
  return VAPID_PUBLIC || null;
}

// ── Payload shape ───────────────────────────────────────────────────────────
//
// Kept tiny on purpose: most push services cap encrypted payloads around
// 4 KB and some Android clients drop notifications when the JSON is large.
export interface PushPayload {
  /** Bold first line of the notification. */
  title: string;
  /** Secondary line. Two short sentences max — long bodies get truncated. */
  body: string;
  /** Path the SW will openWindow() to on click. Defaults to `/dashboard`. */
  url?: string;
  /** Optional notification tag — same tag replaces previous notifications. */
  tag?: string;
  /** Icon URL (defaults to /storyvenue-sidebar-mark.png). */
  icon?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Fan a payload out to every device registered for a venue.
 *
 * Returns { sent, pruned, failed } counts so callers (and tests) can verify
 * delivery without parsing logs. Never throws.
 */
export async function sendPushToVenue(
  venueId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!configureOnce()) return { sent: 0, pruned: 0, failed: 0 };

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('venue_id', venueId);

  if (error) {
    console.error('[push] subscription lookup failed:', error.message);
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const subs = (data as SubscriptionRow[] | null) ?? [];
  if (subs.length === 0) {
    return { sent: 0, pruned: 0, failed: 0 };
  }

  return sendToSubscriptions(subs, payload);
}

/** Send to a specific list of stored subscription rows. */
export async function sendToSubscriptions(
  subs: SubscriptionRow[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!configureOnce()) return { sent: 0, pruned: 0, failed: 0 };

  // Trim payload to a safe size. Title + body limits are conservative —
  // some Android shells truncate body around ~120 chars.
  const safePayload: PushPayload = {
    title: payload.title.slice(0, 120),
    body:  payload.body.slice(0, 240),
    url:   payload.url,
    tag:   payload.tag,
    icon:  payload.icon,
  };
  const json = JSON.stringify(safePayload);

  const deadIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        json,
        { TTL: 60 * 60 * 24 }, // 24h — longer than the user's likely offline window
      );
      sent += 1;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      const message = err instanceof Error ? err.message : String(err);
      // 404 = Not Found (endpoint never existed for this push service)
      // 410 = Gone (user disabled notifications / cleared browser data)
      // Both mean the subscription is permanently dead — purge it.
      if (status === 404 || status === 410) {
        deadIds.push(sub.id);
      } else {
        failed += 1;
        await supabaseAdmin
          .from('push_subscriptions')
          .update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString() })
          .eq('id', sub.id)
          .then(() => undefined, () => undefined);
        console.warn('[push] delivery error', { endpoint: redact(sub.endpoint), status, message });
      }
    }
  }));

  if (deadIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('id', deadIds);
    if (delErr) {
      console.warn('[push] failed to prune dead subscriptions:', delErr.message);
    }
  }

  return { sent, pruned: deadIds.length, failed };
}

function redact(endpoint: string): string {
  // Hide the unique identifier at the end of the URL so logs are safer to
  // ship to third-party services like Sentry.
  return endpoint.replace(/\/[^/]+$/, '/<token>');
}
