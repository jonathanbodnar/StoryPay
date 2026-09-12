import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getPinterestConnection, isPinterestConfigured } from '@/lib/pinterest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — is this couple connected to Pinterest? */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const conn = await getPinterestConnection(user.id);
  return NextResponse.json({ ...conn, configured: isPinterestConfigured() });
}
