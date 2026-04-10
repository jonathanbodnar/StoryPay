import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getQuickBooksAuthUrl, getFreshBooksAuthUrl, isConfigured } from '@/lib/accounting';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider } = await request.json();

  if (!['quickbooks', 'freshbooks'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  if (!isConfigured(provider)) {
    return NextResponse.json({
      error: `${provider} is not configured. Please add FRESHBOOKS_CLIENT_ID, FRESHBOOKS_CLIENT_SECRET, and FRESHBOOKS_REDIRECT_URI environment variables.`,
    }, { status: 400 });
  }

  const state = Buffer.from(JSON.stringify({ venueId, provider })).toString('base64url');

  if (provider === 'quickbooks') {
    return NextResponse.json({ url: getQuickBooksAuthUrl(state) });
  }

  return NextResponse.json({ url: getFreshBooksAuthUrl(state) });
}
