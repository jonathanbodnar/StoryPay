/**
 * Super-admin only — diagnose the live Postgres connection string.
 *
 * Returns sanitized info about which env var is being used, the username,
 * hostname, and port — so you can verify Railway / Vercel env vars are
 * correct without leaking the password.
 *
 * Also runs a quick `SELECT 1` to confirm the credentials actually work.
 */
import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DiagInfo {
  source:        'DATABASE_URL' | 'SUPABASE_DB_URL' | 'POSTGRES_URL' | 'POSTGRES_PRISMA_URL' | 'NONE';
  username:      string | null;
  hostname:      string | null;
  port:          string | null;
  database:      string | null;
  isPooler:      boolean;
  isDirectHost:  boolean;
  usernameOk:    boolean;
  warning:       string | null;
}

function inspect(varName: DiagInfo['source'], val: string | undefined): DiagInfo | null {
  if (!val) return null;
  try {
    const u = new URL(val);
    const username = decodeURIComponent(u.username);
    const hostname = u.hostname;
    const port     = u.port;
    const database = u.pathname.replace(/^\//, '');
    const isPooler     = /\.pooler\.supabase\.com$/i.test(hostname);
    const isDirectHost = /^db\.[a-z0-9]+\.supabase\.co$/i.test(hostname);
    // Pooler requires postgres.PROJECT_REF format
    const usernameOk = isPooler ? /^postgres\.[a-z0-9]+$/i.test(username) : username === 'postgres';

    let warning: string | null = null;
    if (isPooler && !usernameOk) {
      warning = `Pooler host detected but username is "${username}" — must be "postgres.<PROJECT_REF>" (e.g. postgres.blclfnsztrxfhcfauzer).`;
    } else if (isDirectHost && port === '5432') {
      warning = 'Direct host (db.*.supabase.co:5432) is IPv6-only on free tier. Switch to the Transaction Pooler URL.';
    }
    return { source: varName, username, hostname, port, database, isPooler, isDirectHost, usernameOk, warning };
  } catch {
    return { source: varName, username: null, hostname: null, port: null, database: null, isPooler: false, isDirectHost: false, usernameOk: false, warning: 'Could not parse URL' };
  }
}

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Inspect every possible source in priority order
  const candidates: Array<DiagInfo | null> = [
    inspect('DATABASE_URL',        process.env.DATABASE_URL),
    inspect('SUPABASE_DB_URL',     process.env.SUPABASE_DB_URL),
    inspect('POSTGRES_URL',        process.env.POSTGRES_URL),
    inspect('POSTGRES_PRISMA_URL', process.env.POSTGRES_PRISMA_URL),
  ];

  const present = candidates.filter((c): c is DiagInfo => c !== null);
  const active  = present[0] ?? null;

  if (!active) {
    return NextResponse.json({
      ok: false,
      message: 'No database connection string is set. Add DATABASE_URL or SUPABASE_DB_URL to Railway env vars.',
      candidates: [],
    });
  }

  // Try a real connection with the active config
  let pingResult: { ok: boolean; error?: string } = { ok: false };
  try {
    const { getDbAsync } = await import('@/lib/db');
    const sql = await getDbAsync();
    const rows = await sql`SELECT 1 as ok`;
    pingResult = { ok: rows.length === 1 };
  } catch (e) {
    pingResult = {
      ok: false,
      error: e instanceof Error ? e.message : 'unknown error',
    };
  }

  return NextResponse.json({
    ok: pingResult.ok,
    activeSource: active.source,
    active,
    allCandidates: present.map(c => ({
      source: c.source,
      username: c.username,
      hostname: c.hostname,
      port: c.port,
      isPooler: c.isPooler,
      isDirectHost: c.isDirectHost,
      usernameOk: c.usernameOk,
      warning: c.warning,
    })),
    pingResult,
    expectedFormat: 'postgresql://postgres.blclfnsztrxfhcfauzer:<PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  });
}
