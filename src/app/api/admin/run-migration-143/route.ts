import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 143 — create public.analytics_events, the product-usage / funnel
 * event stream that powers the super-admin "Usage Analytics" tab (top metrics,
 * signup→activation funnel, top pages/clicks, trending, live feed).
 *
 * Uses the direct Postgres client (getDbAsync). Idempotent — safe to re-run.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sql = await getDbAsync();

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.analytics_events (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at   timestamptz NOT NULL DEFAULT now(),
        event        text        NOT NULL,
        kind         text        NOT NULL DEFAULT 'auto',
        venue_id     uuid        REFERENCES public.venues(id) ON DELETE SET NULL,
        user_email   text,
        role         text,
        path         text,
        label        text,
        session_id   text,
        properties   jsonb
      );
    `);

    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON public.analytics_events (created_at DESC);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_event_idx      ON public.analytics_events (event);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_kind_idx       ON public.analytics_events (kind);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_venue_id_idx   ON public.analytics_events (venue_id);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_path_idx       ON public.analytics_events (path);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_session_idx    ON public.analytics_events (session_id);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS analytics_events_milestone_idx  ON public.analytics_events (venue_id, event) WHERE kind = 'milestone';`);

    await sql.unsafe(`ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;`);

    // Reload PostgREST schema cache so supabaseAdmin.from('analytics_events') works.
    await sql.unsafe(`NOTIFY pgrst, 'reload schema';`);

    return NextResponse.json({ ok: true, migration: 143, message: 'analytics_events table ready.' });
  } catch (err) {
    console.error('[run-migration-143]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() { return POST(); }
