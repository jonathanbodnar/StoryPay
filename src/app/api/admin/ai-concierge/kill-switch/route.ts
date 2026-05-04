/**
 * Super-admin global kill-switch endpoint for AI Concierge.
 *
 *   GET   → current settings + context (reason, who set it, when, last update)
 *   PATCH → toggle the switch with optional reason
 *
 * The switch lives in `ai_runtime_settings` (singleton row, id=1). Both the
 * activation cron and the send cron consult it on every tick (with a 30-second
 * cache) and short-circuit when it's on. After a PATCH we manually clear the
 * cache so the operator's "instant" expectation matches reality.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  getAiRuntimeSettings,
  setAiKillSwitch,
  clearRuntimeSettingsCache,
} from '@/lib/ai-concierge/runtime-settings';

export const dynamic = 'force-dynamic';

interface PatchBody {
  enabled?: boolean;
  reason?:  string | null;
}

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Force a fresh read so the admin panel never sees stale data.
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
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '"enabled" boolean is required' }, { status: 400 });
  }

  try {
    const updated = await setAiKillSwitch({
      enabled: body.enabled,
      reason:  body.reason ?? null,
      setBy:   'admin',
    });
    clearRuntimeSettingsCache();
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to update kill switch';
    if (msg.includes('does not exist') || msg.includes('42P01')) {
      return NextResponse.json({
        error: 'ai_runtime_settings table missing — run /api/admin/run-migration-099 first',
        schemaMissing: true,
      }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
