import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { error } = await supabaseAdmin.rpc('update_announcement', {
    p_id:        id,
    p_message:   body.message   ?? null,
    p_link_text: body.link_text ?? null,
    p_link_url:  body.link_url  ?? null,
    p_is_active: body.is_active ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { error } = await supabaseAdmin.rpc('delete_announcement', { p_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
