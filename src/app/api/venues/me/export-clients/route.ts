/**
 * GET /api/venues/me/export-clients
 *
 * Returns all venue_customers for the authenticated venue as a CSV download.
 * Includes contact info, pipeline stage, notes count, and key dates.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Fetch all venue customers using actual table column names
  const { data: customers, error } = await supabaseAdmin
    .from('venue_customers')
    .select(`
      id, customer_email, first_name, last_name, phone,
      partner_first_name, partner_last_name,
      wedding_date, guest_count, ceremony_type,
      pipeline_stage, stage_id, referral_source,
      ghl_contact_id, lunarpay_customer_id,
      created_at, updated_at
    `)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = customers ?? [];

  // CSV headers
  const headers = [
    'ID', 'First Name', 'Last Name', 'Email', 'Phone',
    'Partner First Name', 'Partner Last Name',
    'Wedding/Event Date', 'Guest Count', 'Ceremony Type',
    'Pipeline Stage', 'Referral Source',
    'Legacy Contact ID', 'LunarPay Customer ID', 'Created At', 'Updated At',
  ];

  const lines: string[] = [headers.join(',')];

  for (const c of rows) {
    const row = [
      escapeCsv(c.id),
      escapeCsv(c.first_name),
      escapeCsv(c.last_name),
      escapeCsv(c.customer_email),
      escapeCsv(c.phone),
      escapeCsv(c.partner_first_name),
      escapeCsv(c.partner_last_name),
      escapeCsv(c.wedding_date),
      escapeCsv(c.guest_count),
      escapeCsv(c.ceremony_type),
      escapeCsv(c.pipeline_stage),
      escapeCsv(c.referral_source),
      escapeCsv(c.ghl_contact_id),
      escapeCsv(c.lunarpay_customer_id),
      escapeCsv(c.created_at ? new Date(c.created_at).toISOString() : ''),
      escapeCsv(c.updated_at ? new Date(c.updated_at).toISOString() : ''),
    ];
    lines.push(row.join(','));
  }

  const csv = lines.join('\n');
  const filename = `clients_export_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
