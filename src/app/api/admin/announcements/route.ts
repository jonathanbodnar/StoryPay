import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await supabaseAdmin.from('announcements').select('*').order('created_at', { ascending: false });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { message, link_text, link_url, is_active } = await request.json();
  if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from('announcements')
    .insert({ message: message.trim(), link_text: link_text?.trim() || null, link_url: link_url?.trim() || null, is_active: is_active ?? true })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
