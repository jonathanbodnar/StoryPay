import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    // 1. Reset orphaned calendar_id references
    await sql`
      UPDATE public.venue_calendar_notifications
      SET calendar_id = NULL
      WHERE calendar_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.venue_calendars
          WHERE public.venue_calendars.id = public.venue_calendar_notifications.calendar_id
        )
    `;

    // 2. Deduplicate NULL rows — keep the most recently updated
    await sql`
      DELETE FROM public.venue_calendar_notifications a
      USING public.venue_calendar_notifications b
      WHERE a.calendar_id IS NULL
        AND b.calendar_id IS NULL
        AND a.venue_id          = b.venue_id
        AND a.notification_type = b.notification_type
        AND a.channel           = b.channel
        AND a.updated_at        < b.updated_at
    `;

    // 3. Drop the old full unique constraint
    await sql`
      ALTER TABLE public.venue_calendar_notifications
        DROP CONSTRAINT IF EXISTS venue_calendar_notifications_venue_id_notification_type_channel_key
    `;

    // 4a. Partial unique index for venue-wide defaults
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vcn_default_uidx
        ON public.venue_calendar_notifications (venue_id, notification_type, channel)
        WHERE calendar_id IS NULL
    `;

    // 4b. Partial unique index for per-calendar overrides
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vcn_per_calendar_uidx
        ON public.venue_calendar_notifications (venue_id, notification_type, channel, calendar_id)
        WHERE calendar_id IS NOT NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 084 applied — fixed multi-calendar notification unique constraints',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-084]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
