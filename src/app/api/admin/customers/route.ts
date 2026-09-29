import { cookies } from 'next/headers';
import { verifyMasterAdminToken } from '@/lib/admin-token';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return verifyMasterAdminToken(token);
}

/** The dashboard's Unique contacts list: couples on proposals created in the date range, demo venue left out. */
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  const { data: demos } = await supabaseAdmin.from('venues').select('id').eq('is_demo', true);
  const notDemo = `(${(demos ?? []).map((d) => d.id).join(',') || '00000000-0000-0000-0000-000000000000'})`;
  let q = supabaseAdmin
    .from('proposals')
    .select('customer_name, customer_email, customer_phone, price, status, created_at, venue_id')
    .not('venue_id', 'in', notDemo)
    .order('created_at', { ascending: false });
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', `${to}T23:59:59.999Z`);
  const { data } = await q;

  // Deduplicate by email
  const seen = new Set<string>();
  const customers = (data ?? [])
    .filter(r => { const key = r.customer_email || r.customer_name; if (!key || seen.has(key)) return false; seen.add(key); return true; })
    .map(r => ({ id: r.customer_email, name: r.customer_name, email: r.customer_email, phone: r.customer_phone, created_at: r.created_at }));

  return NextResponse.json(customers);
}
