import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { verifySupportAccess } from '@/lib/support/auth';
import { realtimeTopic, topicAllowed } from '@/lib/realtime/topic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/realtime/topics   Body: { names: string[] }
 *
 * The secret Realtime topic for each logical channel name the caller may
 * listen on (lib/realtime/topic.ts). Names the caller isn't allowed are left
 * out of the answer.
 */
export async function POST(request: NextRequest) {
  let body: { names?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const names = Array.isArray(body.names)
    ? [...new Set(body.names.filter((n): n is string => typeof n === 'string' && n.length > 0))].slice(0, 50)
    : [];
  if (!names.length) return NextResponse.json({ topics: {} });

  const [{ isSuperAdmin, agent }, venueId] = await Promise.all([verifySupportAccess(), getVenueId()]);
  const caller = { admin: isSuperAdmin || !!agent, venueId };
  if (!caller.admin && !caller.venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const topics: Record<string, string> = {};
  for (const name of names) {
    if (topicAllowed(name, caller)) topics[name] = realtimeTopic(name);
  }
  return NextResponse.json({ topics }, { headers: { 'Cache-Control': 'private, no-store' } });
}
