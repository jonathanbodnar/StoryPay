/**
 * GET  /api/onboarding/setup-guide — the signed-in venue's Setup Guide: which
 *      steps are ticked and which are really set up, the lesson videos, and
 *      whether it should open by itself after this sign-in.
 * POST /api/onboarding/setup-guide { step, done? } — the venue ticks a step
 *      off (or unticks it). Any step: they're suggestions, and saying "done"
 *      is theirs to say. Whether it's really set up is worked out separately,
 *      and keeps the reminder pill up until it is.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { IMPERSONATION_COOKIE, isAdminImpersonating } from '@/lib/admin-impersonation';
import { loadSetupGuide } from '@/lib/setup-guide-server';
import { setupLesson, withSetupStep } from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jar = await cookies();
  const state = await loadSetupGuide(user.venueId, {
    canManage: user.isAdmin,
    impersonating: isAdminImpersonating(jar.get(IMPERSONATION_COOKIE)?.value, user.venueId),
  });
  if (!state) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // When this sign-in happened (the session's issue time). The dashboard opens
  // the guide once per sign-in, so it remembers the last one it opened for.
  const loginId = jar.get('venue_id_meta')?.value?.split('.')[0] || null;
  return NextResponse.json({ ...state, loginId });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Only the venue owner or an admin can do this.' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { step?: unknown; done?: unknown } | null;
  const lesson = typeof body?.step === 'string' ? setupLesson(body.step) : undefined;
  if (!lesson) return NextResponse.json({ error: 'That isn’t a step in the guide.' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('onboarding_steps_completed')
    .eq('id', user.venueId)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from('venues')
    .update({ onboarding_steps_completed: withSetupStep(venue?.onboarding_steps_completed, lesson.id, body?.done !== false) })
    .eq('id', user.venueId);
  if (error) {
    console.error('[setup-guide] tick step:', error.message);
    return NextResponse.json({ error: 'Could not save that step.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
