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
      ALTER TABLE public.marketing_tags
        ADD COLUMN IF NOT EXISTS is_system          boolean   NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS system_key         text,
        ADD COLUMN IF NOT EXISTS category           text,
        ADD COLUMN IF NOT EXISTS description        text,
        ADD COLUMN IF NOT EXISTS auto_apply_events  text[]    NOT NULL DEFAULT '{}'
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS marketing_tags_venue_system_key_uidx
        ON public.marketing_tags (venue_id, system_key)
        WHERE system_key IS NOT NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 085 applied — system tags columns added to marketing_tags',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-085]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
