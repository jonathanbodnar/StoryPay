/**
 * GET /api/staging/integrations?service=&since= — what the test copy's
 * stand-ins for Tripleseat, Event Temple, Calendly and Google Calendar were
 * sent (newest first; lib/staging-integrations). Test copy only (behind its
 * password page); not found on the live site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStaging } from '@/lib/staging';
import { integrationCalls } from '@/lib/staging-integrations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  return NextResponse.json({ calls: integrationCalls({ service: sp.get('service') ?? undefined, since: sp.get('since') ?? undefined }) });
}
