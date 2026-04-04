import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const { email, name } = await request.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({ email: email.toLowerCase().trim(), name: name?.trim() || null });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ message: "You're already on the list!" }, { status: 200 });
    }
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }

  return NextResponse.json({ message: 'success' }, { status: 201 });
}

export async function GET() {
  // Admin-only count endpoint
  const { count } = await supabaseAdmin
    .from('waitlist')
    .select('*', { count: 'exact', head: true });
  return NextResponse.json({ count: count ?? 0 });
}
