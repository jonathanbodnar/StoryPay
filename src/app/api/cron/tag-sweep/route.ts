/**
 * GET /api/cron/tag-sweep (Bearer or ?secret= CRON_SECRET / MARKETING_CRON_SECRET)
 *
 * Runs the nightly tag sweep (lib/tag-sweep.ts) on demand. The in-app
 * scheduler runs it every night at 3:00 AM UTC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runTagSweep } from '@/lib/tag-sweep';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.MARKETING_CRON_SECRET ?? '';

function authOk(req: NextRequest): boolean {
  if (!CRON_SECRET) return true;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs = req.nextUrl.searchParams.get('secret')?.trim();
  return bearer === CRON_SECRET || qs === CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const counts = await runTagSweep();
  return NextResponse.json({ ok: true, counts });
}
