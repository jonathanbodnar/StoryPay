import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const status = request.nextUrl.searchParams.get('status');

  let q = supabaseAdmin
    .from('proposals')
    .select('id, customer_name, customer_email, price, status, created_at, paid_at')
    .order('created_at', { ascending: false });

  if (status === 'failed') {
    q = q.in('status', ['failed', 'declined']);
  } else if (status === 'pending') {
    q = q.in('status', ['sent', 'opened', 'signed']);
  }

  const { data } = await q;
  return NextResponse.json(data ?? []);
}
