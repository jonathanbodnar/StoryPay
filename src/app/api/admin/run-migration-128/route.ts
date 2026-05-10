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
      ALTER TABLE public.venue_pricing_guides
        ADD COLUMN IF NOT EXISTS about_photos JSONB NOT NULL DEFAULT '[]'::jsonb
    `;

    return NextResponse.json({
      success: true,
      message: 'Migration 128 applied — about_photos column added to venue_pricing_guides.',
    });
  } catch (err) {
    console.error('[run-migration-128]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
