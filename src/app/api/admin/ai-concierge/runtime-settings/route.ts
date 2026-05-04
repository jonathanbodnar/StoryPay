/**
 * Super-admin platform-wide AI Concierge runtime settings.
 *
 *   GET   → full runtime-settings snapshot (kill switch + platform defaults).
 *   PATCH → update one or more fields. Currently supports:
 *             - default_daily_send_cap (integer, 1..100000)
 *
 * Kill switch updates remain on `/api/admin/ai-concierge/kill-switch` (the UI
 * card already wires to that endpoint, and the wide red toggle deserves its
 * own dedicated path so a future "are-you-sure" interstitial slots in
 * cleanly).
 *
 * After any update we force a fresh re-read so the admin panel sees the
 * value it just wrote without waiting on the 30s cache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  getAiRuntimeSettings,
  setDefaultDailySendCap,
  clearRuntimeSettingsCache,
} from '@/lib/ai-concierge/runtime-settings';

export const dynamic = 'force-dynamic';

interface PatchBody {
  default_daily_send_cap?: number | null;
}

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await getAiRuntimeSettings(true);
  return NextResponse.json(settings);
}

export async function PATCH(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PatchBody;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let touched = false;

  // default_daily_send_cap
  if (body.default_daily_send_cap !== undefined && body.default_daily_send_cap !== null) {
    const n = Number(body.default_daily_send_cap);
    if (!Number.isFinite(n) || n < 1 || n > 100_000) {
      return NextResponse.json({
        error: 'default_daily_send_cap must be an integer between 1 and 100000',
      }, { status: 422 });
    }
    try {
      await setDefaultDailySendCap({ cap: Math.floor(n) });
      touched = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('does not exist') || msg.includes('42P01') || msg.includes('42703')) {
        return NextResponse.json({
          error: 'ai_runtime_settings.default_daily_send_cap missing — run /api/admin/run-migration-100 first',
          schemaMissing: true,
        }, { status: 503 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (!touched) {
    return NextResponse.json({ error: 'No supported fields in patch' }, { status: 400 });
  }

  clearRuntimeSettingsCache();
  const updated = await getAiRuntimeSettings(true);
  return NextResponse.json(updated);
}
