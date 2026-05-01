export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

export async function OPTIONS() { return corsPreflight(); }

interface ContactRow {
  id: string;
  venue_id: string;
  customer_email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  partner_email: string | null;
  partner_phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  pipeline_stage: string;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

function shape(c: ContactRow) {
  return {
    id: c.id,
    email: c.customer_email,
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    full_name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
    phone: c.phone || '',
    partner_first_name: c.partner_first_name || '',
    partner_last_name: c.partner_last_name || '',
    partner_email: c.partner_email || '',
    partner_phone: c.partner_phone || '',
    wedding_date: c.wedding_date,
    guest_count: c.guest_count,
    pipeline_stage: c.pipeline_stage,
    tags: c.tags || [],
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/** GET — list contacts. Supports `?limit=` and `?email=` filter. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const email = url.searchParams.get('email')?.toLowerCase() || null;

  let q = supabaseAdmin
    .from('venue_customers')
    .select('*')
    .eq('venue_id', auth.venueId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (email) q = q.eq('customer_email', email);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    { contacts: ((data || []) as ContactRow[]).map(shape), count: (data || []).length },
    { headers: CORS_HEADERS },
  );
}

/** POST — create or upsert a contact (matched by venue+email). */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    partner_first_name?: string;
    partner_last_name?: string;
    partner_email?: string;
    partner_phone?: string;
    wedding_date?: string;
    guest_count?: number;
  };

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'email_required' }, { status: 400, headers: CORS_HEADERS });
  }

  const { data: existing } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', auth.venueId)
    .eq('customer_email', email)
    .maybeSingle();
  const isNew = !existing;

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id: auth.venueId,
        customer_email: email,
        first_name: body.first_name || '',
        last_name: body.last_name || '',
        phone: body.phone || null,
        partner_first_name: body.partner_first_name || null,
        partner_last_name: body.partner_last_name || null,
        partner_email: body.partner_email || null,
        partner_phone: body.partner_phone || null,
        wedding_date: body.wedding_date || null,
        guest_count: body.guest_count ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  const shaped = shape(data as ContactRow);
  void dispatchIntegrationEvent(auth.venueId, isNew ? 'contact.created' : 'contact.updated', { contact: shaped });

  return NextResponse.json({ contact: shaped, created: isNew }, { headers: CORS_HEADERS });
}
