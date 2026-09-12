import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { ensurePinterestToken, listBoards } from '@/lib/pinterest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — list the connected couple's Pinterest boards. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await ensurePinterestToken(user.id);
  if (!token) return NextResponse.json({ error: 'Connect Pinterest first.' }, { status: 409 });

  const boards = await listBoards(token);
  return NextResponse.json({ boards });
}
