/**
 * GET /api/staging/version — which commit the test copy is running.
 * The checks runner (scripts/checks/runner.mjs) waits here until its own
 * commit is being served before it tests anything.
 * Test copy only (behind its password page); not found on the live site.
 */

import { NextResponse } from 'next/server';
import { isStaging } from '@/lib/staging';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  return NextResponse.json({ sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null });
}
