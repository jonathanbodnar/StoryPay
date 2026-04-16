import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function probe(table: string) {
  const { data, error, status } = await supabaseAdmin
    .from(table)
    .select('*')
    .limit(1);
  return {
    table,
    status,
    error_code: (error as { code?: string } | null)?.code ?? null,
    error_message: error?.message ?? null,
    sample_keys: Array.isArray(data) && data[0] ? Object.keys(data[0]) : [],
    row_count: Array.isArray(data) ? data.length : null,
  };
}

export async function GET() {
  const tables = [
    'profiles',
    'venues',
    'leads',
    'customers',
    'proposals',
    'subscriptions',
  ];
  const results = await Promise.all(tables.map(probe));
  return NextResponse.json({ results });
}
