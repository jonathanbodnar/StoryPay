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

  // Select only columns that are guaranteed to exist on every deploy.
  // (Some optional columns like `timezone` may not be present on older DBs;
  //  pulling them in this connection-test endpoint would block all Zapier
  //  connections if the column is missing.)
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, email, brand_color, brand_logo_url')
    .eq('id', auth.venueId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      {
        error: 'venue_not_found',
        debug: {
          venue_id_from_key: auth.venueId,
          query_error: error?.message ?? null,
          query_code: (error as { code?: string } | null)?.code ?? null,
          query_details: (error as { details?: string } | null)?.details ?? null,
        },
      },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // Best-effort timezone lookup — never fail the connection test on this.
  let timezone: string | null = null;
  try {
    const tz = await supabaseAdmin
      .from('venues')
      .select('timezone')
      .eq('id', auth.venueId)
      .maybeSingle();
    timezone = (tz.data as { timezone?: string | null } | null)?.timezone ?? null;
  } catch {
    timezone = null;
  }

  return NextResponse.json(
    {
      venue: { ...data, timezone },
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
