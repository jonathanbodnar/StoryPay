/**
 * GET  /api/onboarding/setup-guide — the signed-in venue's Setup Guide: which
 *      steps are done, the lesson videos, and whether it should open by itself
 *      after this sign-in.
 * POST /api/onboarding/setup-guide { step } — tick one of the two steps that
 *      have nothing to detect (follow_up, grow). Every other step is done when
 *      the thing exists, so it can't be ticked from here.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { IMPERSONATION_COOKIE, isAdminImpersonating } from '@/lib/admin-impersonation';
import { loadSetupGuide } from '@/lib/setup-guide-server';
import { MANUAL_STEP_PREFIX, setupLesson } from '@/lib/setup-guide';

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

  const body = (await req.json().catch(() => null)) as { step?: unknown } | null;
  const lesson = typeof body?.step === 'string' ? setupLesson(body.step) : undefined;
  if (!lesson?.manual) {
    return NextResponse.json({ error: 'That step is done by setting it up, not by ticking it.' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('onboarding_steps_completed')
    .eq('id', user.venueId)
    .maybeSingle();
  const current = Array.isArray(venue?.onboarding_steps_completed)
    ? (venue.onboarding_steps_completed as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const key = `${MANUAL_STEP_PREFIX}${lesson.id}`;
  if (!current.includes(key)) {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_steps_completed: [...current, key] })
      .eq('id', user.venueId);
    if (error) {
      console.error('[setup-guide] tick step:', error.message);
      return NextResponse.json({ error: 'Could not save that step.' }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
