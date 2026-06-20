import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
// Revalidate every 5 minutes so new signups show up promptly
export const revalidate = 300;

/**
 * Public endpoint — no auth required.
 * Returns the 20 most recently registered venue names (newest first).
 * Only the name is returned — no PII.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .select('name')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ names: [] }, { status: 200 });
    }

    const names = (data ?? [])
      .map((r) => (r.name as string | null)?.trim())
      .filter(Boolean) as string[];

    return NextResponse.json(
      { names },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch {
    return NextResponse.json({ names: [] }, { status: 200 });
  }
}
