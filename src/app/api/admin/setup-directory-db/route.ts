import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Idempotent directory-integration migration.
 *
 * The `venues` table already holds every directory field (slug, location,
 * capacity, features, cover_image_url, gallery_images, is_published, …) and
 * `leads` already exists with a `venue_id` FK to `venues`. All this endpoint
 * does is ensure the small set of additive pieces the dashboard needs:
 *
 *   • `leads.source`      — how the lead arrived ("directory", "manual", …)
 *   • `leads.updated_at`  — last-modified timestamp, with a trigger
 *   • indexes on status / created_at / email for the dashboard inbox
 *   • a trigger that bumps `updated_at` on every UPDATE
 *
 * Safe to run repeatedly.
 */
const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: 'leads.source',
    sql: `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'directory'`,
  },
  {
    name: 'leads.updated_at',
    sql: `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
  },
  {
    name: 'idx_leads_status',
    sql: `CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status)`,
  },
  {
    name: 'idx_leads_created_at',
    sql: `CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC)`,
  },
  {
    name: 'idx_leads_email',
    sql: `CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads (email)`,
  },
  {
    name: 'leads_updated_at_trigger',
    sql: `
      DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
      CREATE TRIGGER leads_updated_at
        BEFORE UPDATE ON public.leads
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    `,
  },
];

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return Boolean(token && token === process.env.ADMIN_SECRET);
}

export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  const results: { name: string; status: 'ok' | 'error'; error?: string }[] = [];

  for (const stmt of STATEMENTS) {
    try {
      await sql.unsafe(stmt.sql);
      results.push({ name: stmt.name, status: 'ok' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[setup-directory-db] ${stmt.name} failed:`, message);
      results.push({ name: stmt.name, status: 'error', error: message });
    }
  }

  const hadErrors = results.some((r) => r.status === 'error');
  return NextResponse.json({ ok: !hadErrors, results }, { status: hadErrors ? 500 : 200 });
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    info: 'POST to this endpoint to ensure the additive directory-integration DDL is in place.',
    statements: STATEMENTS.map((s) => s.name),
  });
}
