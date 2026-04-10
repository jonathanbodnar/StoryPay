import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getQuickBooksAuthUrl, getFreshBooksAuthUrl } from '@/lib/accounting';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider } = await request.json();

  const state = Buffer.from(JSON.stringify({ venueId, provider })).toString('base64url');

  if (provider === 'quickbooks') {
    return NextResponse.json({ url: getQuickBooksAuthUrl(state) });
  }

  if (provider === 'freshbooks') {
    return NextResponse.json({ url: getFreshBooksAuthUrl(state) });
  }

  return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
}
