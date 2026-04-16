import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function countTable(table: string) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true });
  return { table, count: count ?? null, error: error?.message ?? null };
}

export async function GET() {
  const tables = [
    'profiles',
    'venues',
    'leads',
    'customers',
    'proposals',
    'contracts',
    'invoices',
    'payments',
    'subscriptions',
  ];

  const results = await Promise.all(tables.map(countTable));
  return NextResponse.json({ results });
}
