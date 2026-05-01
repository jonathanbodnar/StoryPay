export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * GET/POST /api/admin/run-migration-081
 *
 * Adds google_event_id, google_calendar_id, google_html_link columns to
 * calendar_events so SaaS-created events can be linked back to the Google
 * Calendar events we push (enabling two-way sync for updates/deletes).
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.calendar_events
        ADD COLUMN IF NOT EXISTS google_event_id text,
        ADD COLUMN IF NOT EXISTS google_calendar_id text,
        ADD COLUMN IF NOT EXISTS google_html_link text
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS calendar_events_google_event_id_idx
        ON public.calendar_events (google_event_id)
        WHERE google_event_id IS NOT NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 081 applied — google_event_id linkage added to calendar_events',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-081]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
