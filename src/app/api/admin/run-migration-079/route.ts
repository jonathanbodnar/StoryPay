export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * GET/POST /api/admin/run-migration-079
 *
 * 1. Adds reminder_offsets JSONB column to venue_calendar_notifications so
 *    each channel (email_owner / email_contact / sms_owner / sms_contact) can
 *    have independent reminder timing.
 * 2. Adds channel text column to calendar_event_reminders and updates the
 *    unique index so the same reminder_index can appear for different channels.
 * 3. Seeds default reminder offsets for existing reminder rows.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    // ── 1. Per-channel reminder offsets column ────────────────────────────────
    await sql`
      ALTER TABLE public.venue_calendar_notifications
        ADD COLUMN IF NOT EXISTS reminder_offsets jsonb
    `;

    // ── 2. Channel tag on reminder queue rows ─────────────────────────────────
    await sql`
      ALTER TABLE public.calendar_event_reminders
        ADD COLUMN IF NOT EXISTS channel text
    `;

    await sql`
      ALTER TABLE public.calendar_event_reminders
        DROP CONSTRAINT IF EXISTS calendar_event_reminders_event_idx_uidx
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_reminders_event_ch_idx_uidx
        ON public.calendar_event_reminders (calendar_event_id, channel, reminder_index)
        WHERE channel IS NOT NULL
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_reminders_event_idx_legacy_uidx
        ON public.calendar_event_reminders (calendar_event_id, reminder_index)
        WHERE channel IS NULL
    `;

    // ── 3. Seed default offsets for existing reminder rows ────────────────────
    await sql`
      UPDATE public.venue_calendar_notifications
      SET reminder_offsets = '[{"d":1,"h":0,"m":0},{"d":0,"h":1,"m":0},{"d":0,"h":0,"m":10}]'::jsonb
      WHERE notification_type = 'reminder'
        AND channel IN ('email_owner', 'email_contact')
        AND reminder_offsets IS NULL
    `;

    await sql`
      UPDATE public.venue_calendar_notifications
      SET reminder_offsets = '[{"d":0,"h":1,"m":0},{"d":0,"h":0,"m":10}]'::jsonb
      WHERE notification_type = 'reminder'
        AND channel IN ('sms_owner', 'sms_contact')
        AND reminder_offsets IS NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, message: 'Migration 079 applied successfully.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[run-migration-079]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
