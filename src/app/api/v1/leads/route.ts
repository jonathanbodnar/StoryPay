export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { notifyOwnerNewLead } from '@/lib/owner-notifications';

export async function OPTIONS() { return corsPreflight(); }

interface LeadRow {
  id: string;
  venue_id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  booking_timeline: string | null;
  message: string | null;
  notes: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string | null;
}

function shape(l: LeadRow) {
  return {
    id: l.id,
    first_name: l.first_name || '',
    last_name: l.last_name || '',
    full_name: l.name || [l.first_name, l.last_name].filter(Boolean).join(' ').trim(),
    email: l.email,
    phone: l.phone || '',
    wedding_date: l.wedding_date,
    guest_count: l.guest_count,
    booking_timeline: l.booking_timeline,
    message: l.message,
    notes: l.notes,
    status: l.status,
    source: l.source,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

/** POST — create a new lead. */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    phone?: string;
    wedding_date?: string;
    guest_count?: number;
    booking_timeline?: string;
    message?: string;
    notes?: string;
    source?: string;
  };

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'email_required' }, { status: 400, headers: CORS_HEADERS });
  }

  const firstName = (body.first_name || '').trim();
  const lastName = (body.last_name || '').trim();
  const fullName = (body.name || `${firstName} ${lastName}`).trim();

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id: auth.venueId,
      email,
      first_name: firstName || null,
      last_name: lastName || null,
      name: fullName || null,
      phone: body.phone || null,
      wedding_date: body.wedding_date || null,
      guest_count: body.guest_count ?? null,
      booking_timeline: body.booking_timeline || null,
      message: body.message || null,
      notes: body.notes || null,
      status: 'new',
      source: body.source || 'api',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  // Mirror into venue_customers (CRM) so the lead also shows up in the contact book
  void supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id: auth.venueId,
        customer_email: email,
        first_name: firstName || '',
        last_name: lastName || '',
        phone: body.phone || null,
        wedding_date: body.wedding_date || null,
        guest_count: body.guest_count ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .then(() => {});

  const shaped = shape(data as LeadRow);
  // Push to the owner's enabled devices (no-op unless they opted in).
  notifyOwnerNewLead({
    venueId:  auth.venueId,
    leadId:   shaped.id,
    fullName: shaped.full_name,
    email:    shaped.email,
    source:   shaped.source,
  });
  void dispatchIntegrationEvent(auth.venueId, 'lead.created', { lead: shaped });

  return NextResponse.json({ lead: shaped }, { headers: CORS_HEADERS });
}
