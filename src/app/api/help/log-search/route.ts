import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  const { search_term, result_count } = await request.json() as {
    search_term: string;
    result_count: number;
  };

  if (!search_term?.trim()) {
    return NextResponse.json({ error: 'search_term required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('help_search_logs')
    .insert({
      search_term: search_term.trim().toLowerCase(),
      result_count: result_count ?? 0,
      venue_id: venueId || null,
    });

  if (error) {
    console.error('[log-search] db error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
