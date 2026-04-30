import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureSystemTagsForVenue } from '@/lib/system-tags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Get all venue IDs
    const { data: venues, error } = await supabaseAdmin
      .from('venues')
      .select('id');

    if (error) throw new Error(error.message);

    const venueIds = (venues ?? []).map((v: { id: string }) => v.id);

    // Seed system tags for every venue
    await Promise.all(venueIds.map((id) => ensureSystemTagsForVenue(id)));

    return NextResponse.json({
      success: true,
      message: `System tags seeded for ${venueIds.length} venue(s).`,
      venues: venueIds.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[seed-system-tags]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
