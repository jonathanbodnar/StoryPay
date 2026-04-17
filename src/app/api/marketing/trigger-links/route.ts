import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateTriggerShortCode } from '@/lib/trigger-links';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('trigger_links')
    .select('id, name, target_url, short_code, click_count, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; targetUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!targetUrl) return NextResponse.json({ error: 'Destination URL is required' }, { status: 400 });

  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid destination URL' }, { status: 400 });
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const short_code = generateTriggerShortCode();
    const { data, error } = await supabaseAdmin
      .from('trigger_links')
      .insert({
        venue_id: venueId,
        name,
        target_url: targetUrl,
        short_code,
      })
      .select('id, name, target_url, short_code, click_count, created_at, updated_at')
      .single();

    if (!error && data) {
      return NextResponse.json({ link: data });
    }
    if (error?.code !== '23505') {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Could not allocate a unique short code' }, { status: 500 });
}
