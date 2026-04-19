import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeCsvHeader, parseCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CHUNK = 100;

function colIndex(headers: string[], ...aliases: string[]): number {
  const norm = headers.map(normalizeCsvHeader);
  for (const a of aliases) {
    const i = norm.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ct = request.headers.get('content-type') || '';
  let text: string;

  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Expected file field' }, { status: 400 });
    }
    text = await file.text();
  } else if (ct.includes('text/csv') || ct.includes('text/plain')) {
    text = await request.text();
  } else {
    return NextResponse.json(
      { error: 'Send CSV as multipart field "file" or raw text/csv body' },
      { status: 415 },
    );
  }

  const table = parseCsv(text);
  if (table.length < 2) {
    return NextResponse.json({ error: 'CSV must include a header row and at least one data row' }, { status: 400 });
  }

  const headerRow = table[0]!;
  const iEmail = colIndex(headerRow, 'email', 'e-mail', 'email_address');
  const iFirst = colIndex(headerRow, 'first_name', 'firstname', 'first', 'given_name', 'givenname');
  const iLast = colIndex(headerRow, 'last_name', 'lastname', 'last', 'surname', 'family_name');
  const iPhone = colIndex(headerRow, 'phone', 'mobile', 'telephone', 'tel');

  if (iEmail < 0) {
    return NextResponse.json(
      { error: 'Missing email column (use header: email)' },
      { status: 400 },
    );
  }

  const errors: { line: number; message: string }[] = [];
  const upserts: {
    venue_id: string;
    customer_email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    updated_at: string;
  }[] = [];

  let lineNo = 2;
  for (const row of table.slice(1)) {
    const rawEmail = (row[iEmail] ?? '').trim();
    const emailLower = rawEmail.toLowerCase();
    if (!rawEmail || !emailLower.includes('@')) {
      errors.push({ line: lineNo, message: 'Invalid or empty email' });
      lineNo++;
      continue;
    }

    let first = iFirst >= 0 ? (row[iFirst] ?? '').trim() : '';
    let last = iLast >= 0 ? (row[iLast] ?? '').trim() : '';
    const phone = iPhone >= 0 ? (row[iPhone] ?? '').trim() || null : null;

    if (!first && !last) {
      const local = emailLower.split('@')[0] ?? '';
      first = local || 'Imported';
      last = 'Contact';
    }

    upserts.push({
      venue_id: venueId,
      customer_email: emailLower,
      first_name: first,
      last_name: last,
      phone,
      updated_at: new Date().toISOString(),
    });
    lineNo++;
  }

  let imported = 0;
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const chunk = upserts.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('venue_customers')
      .upsert(chunk, { onConflict: 'venue_id,customer_email' });
    if (error) {
      console.error('[contacts/import]', error);
      return NextResponse.json(
        { error: `Import failed at row ${i + 2}: ${error.message}` },
        { status: 500 },
      );
    }
    imported += chunk.length;
  }

  return NextResponse.json({
    imported,
    skippedInvalid: errors.length,
    errors: errors.slice(0, 50),
    note: 'Rows are saved to StoryPay contacts. LunarPay / GHL are not bulk-synced from this import.',
  });
}
