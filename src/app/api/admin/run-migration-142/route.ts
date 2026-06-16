import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 142 — create the centralized public.error_logs table that powers
 * the super-admin Error Log tab. Captures failures across every surface of the
 * CRM (API, SMS, email, payments, webhooks, cron) for all sub-accounts.
 *
 * Uses the direct Postgres client (getDbAsync) rather than an exec_sql RPC —
 * the RPC isn't present in this project. Idempotent — safe to run repeatedly.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sql = await getDbAsync();

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.error_logs (
        id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at       timestamptz NOT NULL DEFAULT now(),
        last_seen_at     timestamptz NOT NULL DEFAULT now(),
        level            text        NOT NULL DEFAULT 'error',
        source           text        NOT NULL DEFAULT 'api',
        category         text,
        message          text        NOT NULL,
        stack            text,
        venue_id         uuid        REFERENCES public.venues(id) ON DELETE SET NULL,
        user_email       text,
        route            text,
        method           text,
        http_status      integer,
        context          jsonb,
        fingerprint      text,
        occurrence_count integer     NOT NULL DEFAULT 1,
        status           text        NOT NULL DEFAULT 'new',
        resolved_by      text,
        resolved_at      timestamptz,
        notes            text,
        CONSTRAINT error_logs_level_chk
          CHECK (level IN ('info', 'warning', 'error', 'critical')),
        CONSTRAINT error_logs_status_chk
          CHECK (status IN ('new', 'investigating', 'resolved', 'ignored'))
      );
    `);

    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_created_at_idx  ON public.error_logs (created_at DESC);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_last_seen_idx   ON public.error_logs (last_seen_at DESC);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_venue_id_idx    ON public.error_logs (venue_id);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_level_idx       ON public.error_logs (level);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_source_idx      ON public.error_logs (source);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_status_idx      ON public.error_logs (status);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON public.error_logs (fingerprint);`);

    await sql.unsafe(`ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;`);

    // Reload PostgREST schema cache so supabaseAdmin.from('error_logs') works.
    await sql.unsafe(`NOTIFY pgrst, 'reload schema';`);

    return NextResponse.json({ ok: true, migration: 142, message: 'error_logs table ready.' });
  } catch (err) {
    console.error('[run-migration-142]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() { return POST(); }
