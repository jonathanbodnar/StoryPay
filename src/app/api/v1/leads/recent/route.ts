export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/** Polling trigger for "New Lead". */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, first_name, last_name, name, email, phone, wedding_date, guest_count, booking_timeline, message, notes, status, source, created_at, updated_at')
    .eq('venue_id', auth.venueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      leads: (data || []).map((l) => {
        const r = l as { id: string; first_name: string | null; last_name: string | null; name: string | null; email: string; phone: string | null; wedding_date: string | null; guest_count: number | null; booking_timeline: string | null; message: string | null; notes: string | null; status: string; source: string; created_at: string; updated_at: string | null };
        return {
          id: r.id,
          first_name: r.first_name || '',
          last_name: r.last_name || '',
          full_name: r.name || [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
          email: r.email,
          phone: r.phone || '',
          wedding_date: r.wedding_date,
          guest_count: r.guest_count,
          booking_timeline: r.booking_timeline,
          message: r.message,
          notes: r.notes,
          status: r.status,
          source: r.source,
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      }),
    },
    { headers: CORS_HEADERS },
  );
}
