/**
 * Native push delivery (APNs / FCM) — the native-shell counterpart to
 * src/lib/push.ts (web-push). Fans a payload out to every native device token
 * registered for a venue (see migration 186 / device_tokens) using the
 * Firebase Cloud Messaging HTTP v1 API.
 *
 * WHY FCM v1 for everything:
 *   FCM v1 is the single, minimal transport that covers Android natively and
 *   iOS too (once the iOS app is attached to the same Firebase project and an
 *   APNs auth key is uploaded to Firebase — see the setup checklist in the
 *   task report). This avoids standing up a second APNs HTTP/2 + JWT client.
 *
 * REQUIRED ENV (set on Railway — service-account credentials, NEVER commit):
 *   FCM_PROJECT_ID    — Firebase project id (e.g. "storyvenue-app")
 *   FCM_CLIENT_EMAIL  — service-account email from the downloaded JSON key
 *   FCM_PRIVATE_KEY   — service-account private key. Paste the full PEM; if the
 *                       newlines are escaped as literal "\n" (common in env
 *                       UIs) we un-escape them at load time.
 *
 * If any var is missing, sendNativePush() logs a warning once and returns a
 * zeroed result — native push is a soft feature, exactly like web-push, so
 * missing config never breaks the caller (notifyOwner) or the request flow.
 */

import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';
import { getServerBadgeCount } from '@/lib/notification-badge';

const FCM_PROJECT_ID   = process.env.FCM_PROJECT_ID || '';
const FCM_CLIENT_EMAIL = process.env.FCM_CLIENT_EMAIL || '';
// Support both real newlines and the "\n"-escaped form pasted into env UIs.
const FCM_PRIVATE_KEY  = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let _warned = false;

export function isNativePushConfigured(): boolean {
  return Boolean(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY);
}

export interface NativePushPayload {
  title: string;
  body: string;
  /** Path (or absolute URL) the app deep-links to on tap. */
  url?: string;
  /** Arbitrary string data forwarded to the client tap handler. */
  data?: Record<string, string>;
}

interface DeviceTokenRow {
  id: string;
  token: string;
  platform: 'ios' | 'android';
}

// ── OAuth2 access-token cache ────────────────────────────────────────────────
// FCM v1 requires a short-lived OAuth token minted from the service account.
// Cache it in-process until ~1 min before expiry so we don't re-mint per send.
let _cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.value;
  }
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss:   FCM_CLIENT_EMAIL,
        scope: FCM_SCOPE,
        aud:   GOOGLE_TOKEN_URL,
        iat:   nowSec,
        exp:   nowSec + 3600,
      },
      FCM_PRIVATE_KEY,
      { algorithm: 'RS256' },
    );

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      console.error('[native-push] OAuth token mint failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    _cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return _cachedToken.value;
  } catch (err) {
    console.error('[native-push] OAuth token error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fan a payload out to every native device registered for a venue.
 * Returns { sent, pruned, failed } and never throws.
 */
export async function sendNativePush(
  venueId: string,
  payload: NativePushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!isNativePushConfigured()) {
    if (!_warned) {
      console.warn(
        '[native-push] FCM credentials not set — native push disabled. ' +
        'Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY on Railway.',
      );
      _warned = true;
    }
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from('device_tokens')
    .select('id, token, platform')
    .eq('venue_id', venueId);

  if (error) {
    console.error('[native-push] token lookup failed:', error.message);
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const rows = (data as DeviceTokenRow[] | null) ?? [];
  if (rows.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  const accessToken = await getAccessToken();
  if (!accessToken) return { sent: 0, pruned: 0, failed: rows.length };

  // Stamp the app-icon badge on the APNs payload so it updates the instant
  // this push is delivered, even while the app is backgrounded or killed —
  // NativeBadgeSync.tsx (running whenever the app is open) keeps it correct
  // the rest of the time and folds unread leads back in on top of this.
  const badge = await getServerBadgeCount(venueId).catch(() => 0);

  const endpoint = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
  const title = payload.title.slice(0, 120);
  const body  = payload.body.slice(0, 240);
  // FCM data values must all be strings.
  const data_: Record<string, string> = { ...(payload.data ?? {}) };
  if (payload.url) data_.url = payload.url;

  const deadIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(rows.map(async (row) => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title, body },
            data: data_,
            // iOS-specific: sound so the alert presents on the lock screen.
            // Custom keys (e.g. `url`) must ALSO be spread as siblings of
            // `aps` here — explicitly setting `apns.payload` means FCM does
            // NOT reliably auto-merge the top-level `data` object into what
            // actually reaches the device on iOS, so without this the tap
            // handler in NativePushRegistrar.tsx never sees `data.url` and
            // falls back to opening the app with no deep link.
            apns: {
              payload: { aps: { sound: 'default', badge }, ...data_ },
            },
            android: {
              priority: 'high',
              notification: { sound: 'default' },
            },
          },
        }),
      });

      if (res.ok) {
        sent += 1;
        return;
      }

      // FCM returns 404 (NOT_FOUND) / 400 (UNREGISTERED) for stale tokens.
      const errText = await res.text().catch(() => '');
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) {
        deadIds.push(row.id);
      } else {
        failed += 1;
        console.warn('[native-push] delivery error', { platform: row.platform, status: res.status, errText: errText.slice(0, 300) });
      }
    } catch (err) {
      failed += 1;
      console.warn('[native-push] send threw', err instanceof Error ? err.message : err);
    }
  }));

  if (deadIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('device_tokens')
      .delete()
      .in('id', deadIds);
    if (delErr) console.warn('[native-push] failed to prune dead tokens:', delErr.message);
  }

  return { sent, pruned: deadIds.length, failed };
}
