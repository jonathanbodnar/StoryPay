export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_accommodations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pricing_guide_id UUID NOT NULL
          REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
        name        TEXT,
        description TEXT,
        image_url   TEXT,
        position    INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_pricing_guide_accommodations_guide_pos_idx
        ON public.venue_pricing_guide_accommodations(pricing_guide_id, position)
    `;

    return NextResponse.json({
      success: true,
      message: 'Migration 130 applied — venue_pricing_guide_accommodations table created.',
    });
  } catch (err) {
    console.error('[run-migration-130]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
