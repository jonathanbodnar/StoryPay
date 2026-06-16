import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 142 — create the centralized public.error_logs table that powers
 * the super-admin Error Log tab. Captures failures across every surface of the
 * CRM (API, SMS, email, payments, webhooks, cron) for all sub-accounts.
 *
 * Idempotent — safe to run multiple times.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const statements: { label: string; sql: string }[] = [
    {
      label: 'create error_logs table',
      sql: `
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
        );`,
    },
    { label: 'idx created_at',  sql: `CREATE INDEX IF NOT EXISTS error_logs_created_at_idx  ON public.error_logs (created_at DESC);` },
    { label: 'idx last_seen',   sql: `CREATE INDEX IF NOT EXISTS error_logs_last_seen_idx   ON public.error_logs (last_seen_at DESC);` },
    { label: 'idx venue_id',    sql: `CREATE INDEX IF NOT EXISTS error_logs_venue_id_idx    ON public.error_logs (venue_id);` },
    { label: 'idx level',       sql: `CREATE INDEX IF NOT EXISTS error_logs_level_idx       ON public.error_logs (level);` },
    { label: 'idx source',      sql: `CREATE INDEX IF NOT EXISTS error_logs_source_idx      ON public.error_logs (source);` },
    { label: 'idx status',      sql: `CREATE INDEX IF NOT EXISTS error_logs_status_idx      ON public.error_logs (status);` },
    { label: 'idx fingerprint', sql: `CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON public.error_logs (fingerprint);` },
    { label: 'enable RLS',      sql: `ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;` },
    { label: 'reload PostgREST schema cache', sql: `NOTIFY pgrst, 'reload schema';` },
  ];

  const steps: string[] = [];
  for (const s of statements) {
    const { error } = await supabaseAdmin.rpc('exec_sql' as never, { sql: s.sql } as never);
    if (error) {
      return NextResponse.json(
        { error: error.message, step: s.label, applied: steps },
        { status: 500 },
      );
    }
    steps.push(s.label);
  }

  return NextResponse.json({ ok: true, migration: 142, steps, message: 'error_logs table ready.' });
}

export async function GET() { return POST(); }
