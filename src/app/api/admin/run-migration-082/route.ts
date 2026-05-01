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
      CREATE TABLE IF NOT EXISTS public.venue_calendars (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        name        text        NOT NULL,
        color       text        NOT NULL DEFAULT '#1b1b1b',
        description text,
        is_default  boolean     NOT NULL DEFAULT false,
        sort_order  int         NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS venue_calendars_default_uidx
        ON public.venue_calendars (venue_id)
        WHERE is_default = true
    `;

    await sql`
      ALTER TABLE public.calendar_events
        ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.venue_calendars(id) ON DELETE SET NULL
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS calendar_events_calendar_id_idx
        ON public.calendar_events (calendar_id)
        WHERE calendar_id IS NOT NULL
    `;

    await sql`
      ALTER TABLE public.venue_calendar_notifications
        ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.venue_calendars(id) ON DELETE CASCADE
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS venue_calendar_notifications_cal_idx
        ON public.venue_calendar_notifications (venue_id, calendar_id)
        WHERE calendar_id IS NOT NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ success: true, message: 'Migration 082 applied — multi-calendar support added' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-082]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
