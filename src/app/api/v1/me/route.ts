export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Connection-test endpoint Zapier (and other clients) call on connect to
 * verify the API key. Returns minimal venue info — enough for Zapier's
 * "Connection label" feature to show e.g. "Acme Wedding Barn".
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, email, brand_color, brand_logo_url, timezone')
    .eq('id', auth.venueId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: 'venue_not_found' }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json(
    {
      venue: data,
      key: {
        id: auth.apiKey.id,
        name: auth.apiKey.name,
        scopes: auth.apiKey.scopes,
        created_at: auth.apiKey.created_at,
      },
    },
    { headers: CORS_HEADERS },
  );
}
