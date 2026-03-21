import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  return adminToken && adminToken === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('*, venue_tokens(token)')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const venuesWithLinks = venues.map((venue: Record<string, unknown>) => {
    const tokens = venue.venue_tokens as { token: string }[] | null;
    const token = tokens?.[0]?.token;
    return {
      ...venue,
      login_url: token ? `${appUrl}/login/${token}` : null,
    };
  });

  return NextResponse.json({ venues: venuesWithLinks });
}

export async function POST(request: Request) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, email, lunarpay_secret_key, lunarpay_publishable_key, lunarpay_org_token } = body;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .insert({
      name,
      email: email || null,
      lunarpay_secret_key: lunarpay_secret_key || null,
      lunarpay_publishable_key: lunarpay_publishable_key || null,
      lunarpay_org_token: lunarpay_org_token || null,
      onboarding_status: 'pending',
    })
    .select()
    .single();

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  const { data: tokenData, error: tokenError } = await supabaseAdmin
    .from('venue_tokens')
    .insert({ venue_id: venue.id })
    .select()
    .single();

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return NextResponse.json({
    venue: {
      ...venue,
      venue_tokens: [tokenData],
      login_url: `${appUrl}/login/${tokenData.token}`,
    },
  });
}
