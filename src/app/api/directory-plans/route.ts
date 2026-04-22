import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { listDirectoryPlanCatalog } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plans = await listDirectoryPlanCatalog();
  return NextResponse.json({ plans });
}
