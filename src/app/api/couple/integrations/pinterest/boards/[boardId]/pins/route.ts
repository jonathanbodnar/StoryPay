import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { ensurePinterestToken, listBoardPins } from '@/lib/pinterest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — list pins on a board for the connected couple. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { boardId } = await params;

  const token = await ensurePinterestToken(user.id);
  if (!token) return NextResponse.json({ error: 'Connect Pinterest first.' }, { status: 409 });

  const pins = await listBoardPins(token, boardId);
  return NextResponse.json({ pins });
}
