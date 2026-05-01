export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Polling trigger for "New Contact" — Zapier (and other clients) call this
 * every 5–15 minutes. Returns the most recent contacts; Zapier dedupes by id.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, first_name, last_name, phone, partner_first_name, partner_last_name, partner_email, partner_phone, wedding_date, guest_count, pipeline_stage, tags, created_at, updated_at')
    .eq('venue_id', auth.venueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      contacts: (data || []).map((c) => {
        const r = c as { id: string; customer_email: string; first_name: string; last_name: string; phone: string | null; partner_first_name: string | null; partner_last_name: string | null; partner_email: string | null; partner_phone: string | null; wedding_date: string | null; guest_count: number | null; pipeline_stage: string; tags: string[] | null; created_at: string; updated_at: string };
          return {
            id: r.id,
            email: r.customer_email,
            first_name: r.first_name || '',
            last_name: r.last_name || '',
            full_name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
            phone: r.phone || '',
            partner_first_name: r.partner_first_name || '',
            partner_last_name: r.partner_last_name || '',
            partner_email: r.partner_email || '',
            partner_phone: r.partner_phone || '',
            wedding_date: r.wedding_date,
            guest_count: r.guest_count,
            pipeline_stage: r.pipeline_stage,
            tags: r.tags || [],
            created_at: r.created_at,
            updated_at: r.updated_at,
          };
        }),
    },
    { headers: CORS_HEADERS },
  );
}
