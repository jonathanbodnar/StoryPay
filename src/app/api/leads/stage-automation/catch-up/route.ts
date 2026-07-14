import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { catchUpStageAutomation } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * Batch "catch up" every lead currently sitting in a stage into that stage's
 * sequence. Used after a stage toggle was off for a while and the venue owner
 * wants the leads who missed the sequence to receive it now. Enrollments are
 * rate-limited (50 per 5 minutes) inside `catchUpStageAutomation`.
 *
 * Body: { stageId, automationId }
 */
export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { stageId?: string; automationId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const stageId = typeof body.stageId === 'string' ? body.stageId : '';
  const automationId = typeof body.automationId === 'string' ? body.automationId : '';
  if (!stageId || !automationId) {
    return NextResponse.json({ error: 'stageId and automationId are required' }, { status: 400 });
  }

  const result = await catchUpStageAutomation(venueId, stageId, automationId);
  return NextResponse.json({ ok: true, ...result });
}
