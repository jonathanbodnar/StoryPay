import { NextResponse } from 'next/server';
import { getPublicVapidKey } from '@/lib/push';

/**
 * Exposes the public half of the VAPID keypair so the client can call
 * `pushManager.subscribe({ applicationServerKey })`. The private key
 * NEVER leaves the server.
 *
 * Returns 503 when push is not configured (env not set on this deploy) so
 * the client can render a "push not available" state instead of trying to
 * subscribe with an invalid key.
 *
 * No auth required — the public key is, by definition, public.
 */
export async function GET() {
  const key = getPublicVapidKey();
  if (!key) {
    return NextResponse.json(
      { error: 'Push notifications not configured on this server.' },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey: key });
}
