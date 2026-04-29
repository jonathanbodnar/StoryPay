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

  // Fetch all venue customers
  const { data: customers, error } = await supabaseAdmin
    .from('venue_customers')
    .select(`
      id, name, email, phone, instagram, wedding_date,
      partner_name, event_type, guest_count,
      pipeline_stage, stage_id,
      created_at, updated_at,
      ghl_contact_id,
      lead_source, status
    `)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = customers ?? [];

  // CSV headers
  const headers = [
    'ID', 'Name', 'Email', 'Phone', 'Instagram',
    'Partner Name', 'Event Type', 'Wedding/Event Date', 'Guest Count',
    'Pipeline Stage', 'Lead Source', 'Status',
    'GHL Contact ID', 'Created At', 'Updated At',
  ];

  const lines: string[] = [headers.join(',')];

  for (const c of rows) {
    const row = [
      escapeCsv(c.id),
      escapeCsv(c.name),
      escapeCsv(c.email),
      escapeCsv(c.phone),
      escapeCsv(c.instagram),
      escapeCsv(c.partner_name),
      escapeCsv(c.event_type),
      escapeCsv(c.wedding_date),
      escapeCsv(c.guest_count),
      escapeCsv(c.pipeline_stage),
      escapeCsv(c.lead_source),
      escapeCsv(c.status),
      escapeCsv(c.ghl_contact_id),
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
