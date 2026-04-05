import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await supabaseAdmin
    .from('proposals')
    .select('customer_name, customer_email, customer_phone, price, status, created_at, venue_id')
    .order('created_at', { ascending: false });

  // Deduplicate by email
  const seen = new Set<string>();
  const customers = (data ?? [])
    .filter(r => { const key = r.customer_email || r.customer_name; if (!key || seen.has(key)) return false; seen.add(key); return true; })
    .map(r => ({ id: r.customer_email, name: r.customer_name, email: r.customer_email, phone: r.customer_phone, created_at: r.created_at }));

  return NextResponse.json(customers);
}
