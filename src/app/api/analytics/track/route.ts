import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { trackEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/analytics/track — batched ingest for client-fired usage events.
 *
 * Body: { events: Array<{ event, path?, label?, sessionId?, properties? }> }
 *
 * The venue/role/email are resolved server-side from the session cookie so the
 * client can never spoof which account an event belongs to. Best-effort: a bad
 * payload or write failure never errors the user's page. Called via
 * navigator.sendBeacon / fetch keepalive from the UsageTracker component.
 */

interface IncomingEvent {
  event?: string;
  path?: string;
  label?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
}

const MAX_EVENTS = 50;
const ALLOWED_AUTO_EVENTS = new Set(['pageview', 'click']);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { events?: IncomingEvent[] } | null;
    const events = Array.isArray(body?.events) ? body!.events! : [];
    if (events.length === 0) return NextResponse.json({ ok: true, recorded: 0 });

    // Resolve actor server-side (cannot be spoofed by the client).
    const user = await getSessionUser();
    const venueId   = user?.venueId ?? null;
    const role      = user ? user.role : 'anon';
    const userEmail = user?.memberEmail ?? null;

    let recorded = 0;
    for (const e of events.slice(0, MAX_EVENTS)) {
      const name = (e.event || '').toString();
      if (!ALLOWED_AUTO_EVENTS.has(name)) continue; // ingest is only for auto-capture
      await trackEvent({
        event:      name,
        kind:       'auto',
        venueId,
        userEmail,
        role,
        path:       e.path ?? null,
        label:      e.label ?? null,
        sessionId:  e.sessionId ?? null,
        properties: e.properties ?? null,
      });
      recorded++;
    }

    return NextResponse.json({ ok: true, recorded });
  } catch {
    // Never surface tracking errors to the client.
    return NextResponse.json({ ok: true, recorded: 0 });
  }
}
