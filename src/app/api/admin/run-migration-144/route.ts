import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 144 — harden RLS on server-only sensitive tables.
 *
 * venue_tokens / venue_team_members / venue_integrations / venue_notifications /
 * venue_email_templates had `ALL ... USING (true)` policies open to the
 * anon/public role, exposing OAuth tokens, invite tokens (which act as login
 * credentials), and tenant data to anyone holding the publishable key.
 *
 * The backend reaches these tables via the service-role key (bypasses RLS), so
 * dropping the permissive policies locks out anon/authenticated without
 * breaking anything. Idempotent — safe to re-run.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sql = await getDbAsync();

    await sql.unsafe(`DROP POLICY IF EXISTS "service role full access"  ON public.venue_tokens;`);

    await sql.unsafe(`DROP POLICY IF EXISTS "Allow all"                 ON public.venue_team_members;`);
    await sql.unsafe(`DROP POLICY IF EXISTS "venue_team_members_all"    ON public.venue_team_members;`);

    await sql.unsafe(`DROP POLICY IF EXISTS "venue_integrations_all"    ON public.venue_integrations;`);

    await sql.unsafe(`DROP POLICY IF EXISTS "Allow all"                 ON public.venue_notifications;`);

    await sql.unsafe(`DROP POLICY IF EXISTS "Allow all"                 ON public.venue_email_templates;`);
    await sql.unsafe(`DROP POLICY IF EXISTS "venue_email_templates_all" ON public.venue_email_templates;`);

    await sql.unsafe(`ALTER TABLE public.venue_tokens          ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE public.venue_team_members    ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE public.venue_integrations    ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE public.venue_notifications   ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE public.venue_email_templates ENABLE ROW LEVEL SECURITY;`);

    await sql.unsafe(`NOTIFY pgrst, 'reload schema';`);

    return NextResponse.json({
      ok: true,
      migration: 144,
      message: 'Dropped permissive anon/public RLS policies on venue_tokens, venue_team_members, venue_integrations, venue_notifications, venue_email_templates.',
    });
  } catch (err) {
    console.error('[run-migration-144]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() { return POST(); }
