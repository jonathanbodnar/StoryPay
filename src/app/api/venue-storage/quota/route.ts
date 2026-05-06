import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getVenueStorageUsage } from '@/lib/venue-storage-quota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value ?? null;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = await getVenueStorageUsage(venueId);
  return NextResponse.json(status);
}
