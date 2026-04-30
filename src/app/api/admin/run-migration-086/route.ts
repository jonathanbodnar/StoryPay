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
      ALTER TABLE public.venue_calendars
        ADD COLUMN IF NOT EXISTS meeting_duration_min      int,
        ADD COLUMN IF NOT EXISTS meeting_interval_min      int,
        ADD COLUMN IF NOT EXISTS min_scheduling_notice_hrs int,
        ADD COLUMN IF NOT EXISTS date_range_days           int,
        ADD COLUMN IF NOT EXISTS pre_buffer_min            int,
        ADD COLUMN IF NOT EXISTS post_buffer_min           int,
        ADD COLUMN IF NOT EXISTS max_bookings_per_day      int,
        ADD COLUMN IF NOT EXISTS max_bookings_per_slot     int
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 086 applied — per-calendar booking rule columns added to venue_calendars',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-086]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
