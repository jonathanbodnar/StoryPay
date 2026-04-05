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
    .from('waitlist')
    .select('id, first_name, last_name, email, phone, venue_name, referral_source, created_at')
    .order('created_at', { ascending: false });
  return NextResponse.json(data ?? []);
}
