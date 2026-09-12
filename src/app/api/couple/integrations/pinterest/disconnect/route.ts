import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { disconnectPinterest } from '@/lib/pinterest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST — disconnect this couple's Pinterest connection. */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await disconnectPinterest(user.id);
  return NextResponse.json({ ok: true });
}
