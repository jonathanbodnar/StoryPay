import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

// Admin creates a feature request (not tied to a venue)
export async function POST(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, description } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('feature_requests')
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      vote_count: 0,
      status: 'open',
      // No venue_id — admin-created requests are global
    })
    .select('id, title, description, vote_count, status, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
