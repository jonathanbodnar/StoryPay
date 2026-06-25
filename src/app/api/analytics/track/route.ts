import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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
// Auto-capture firehose from the global UsageTracker.
const ALLOWED_AUTO_EVENTS = new Set(['pageview', 'click', 'rage_click', 'session_start']);
// Curated named events components may fire via trackClient(). Anything not
// listed here is dropped so the client can't write arbitrary event names.
const ALLOWED_CLIENT_EVENTS = new Set([
  'ai_settings_opened',
  'payments_setup_opened',
  'trial_wall_hit',
  'upgrade_prompt_viewed',
  'upgrade_started',
  'pricing_guide_inserted',
  'form_error',
  'signup_started',
  // Onboarding → card → publish conversion funnel.
  'onboarding_started',
  'onboarding_details_done',
  'card_shown',
  'card_entered',
]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { events?: IncomingEvent[] } | null;
    const events = Array.isArray(body?.events) ? body!.events! : [];
    if (events.length === 0) return NextResponse.json({ ok: true, recorded: 0 });

    // Drop all events when a super admin is impersonating a venue — their
    // browsing activity should never pollute real usage stats.
    const jar = await cookies();
    if (jar.get('admin_impersonating')?.value === '1') {
      return NextResponse.json({ ok: true, recorded: 0 });
    }

    // Resolve actor server-side (cannot be spoofed by the client).
    const user = await getSessionUser();
    const venueId   = user?.venueId ?? null;
    const role      = user ? user.role : 'anon';
    const userEmail = user?.memberEmail ?? null;

    let recorded = 0;
    for (const e of events.slice(0, MAX_EVENTS)) {
      const name = (e.event || '').toString();
      const isAuto = ALLOWED_AUTO_EVENTS.has(name);
      if (!isAuto && !ALLOWED_CLIENT_EVENTS.has(name)) continue; // allowlist only
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
