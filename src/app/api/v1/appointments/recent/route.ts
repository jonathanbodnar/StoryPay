export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Polling trigger for "New Appointment".
 * Returns calendar events ordered by created_at desc.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const { data, error } = await supabaseAdmin
    .from('calendar_events')
    .select('id, title, event_type, status, start_at, end_at, all_day, customer_email, notes, calendar_id, created_at, updated_at')
    .eq('venue_id', auth.venueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      appointments: (data || []).map((row) => {
        const a = row as { id: string; title: string; event_type: string; status: string; start_at: string; end_at: string; all_day: boolean; customer_email: string | null; notes: string | null; calendar_id: string | null; created_at: string; updated_at: string };
        return {
          id: a.id,
          title: a.title,
          event_type: a.event_type,
          status: a.status,
          start_at: a.start_at,
          end_at: a.end_at,
          all_day: a.all_day,
          customer_email: a.customer_email || '',
          notes: a.notes || '',
          calendar_id: a.calendar_id,
          created_at: a.created_at,
          updated_at: a.updated_at,
        };
      }),
    },
    { headers: CORS_HEADERS },
  );
}
