/**
 * Direct PostgreSQL connection that bypasses PostgREST entirely.
 *
 * supabase-js routes all queries through PostgREST (the REST API layer).
 * PostgREST has an in-memory schema cache that only picks up new tables
 * after a DDL event or restart — this causes "table not found in schema cache"
 * errors for any table created after PostgREST last loaded.
 *
 * This client connects directly to the Postgres wire protocol, bypassing
 * PostgREST and its schema cache entirely.
 *
 * Required env var: DATABASE_URL
 * Your project URL: postgres://postgres.blclfnsztrxfhcfauzer:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
 *
 * To find your password:
 *   Supabase dashboard → Project Settings → Database → Database password
 *
 * To add the env var:
 *   Vercel:  vercel.com → your project → Settings → Environment Variables
 *   Railway: railway.app → your service → Variables tab
 */

import postgres from 'postgres';
import { lookup } from 'dns/promises';
import { setDefaultResultOrder } from 'dns';

// Vercel + Railway runtimes routinely fail to reach Supabase's database
// over IPv6 (ENETUNREACH on 2600:.../5432). Force every Node DNS lookup
// in this process to prefer IPv4 so the postgres driver picks the v4
// address whenever one is available. This is a no-op on hosts that only
// expose IPv6 (e.g. db.<project>.supabase.co on the free tier).
try {
  setDefaultResultOrder('ipv4first');
} catch {
  // Older Node — no-op
}

// Best-effort IPv4 resolution. Returns the original host string when no
// IPv4 record exists so the caller can fall through to the postgres
// driver's own resolution (which may then fail loudly).
async function resolveIPv4(host: string): Promise<string> {
  try {
    const { address } = await lookup(host, { family: 4 });
    return address;
  } catch {
    return host;
  }
}

/**
 * Detect a direct-connection Supabase URL (db.<ref>.supabase.co:5432) and
 * warn loudly. Direct hosts are IPv6-only on the free tier, which is the
 * #1 cause of ENETUNREACH errors on serverless platforms. The pooler
 * (aws-0-<region>.pooler.supabase.com:6543) is IPv4-friendly.
 */
function warnIfDirectHost(host: string, port: string): void {
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(host) && port === '5432') {
    console.warn(
      '[db] DATABASE_URL uses the direct Supabase host (db.*.supabase.co:5432), ' +
      'which is IPv6-only on free tier and frequently unreachable from serverless ' +
      'runtimes. Switch to the connection pooler:\n' +
      '  postgres://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres\n' +
      'Find this string under Supabase → Project Settings → Database → Connection string → Transaction pooler.',
    );
  }
}

let _sql: ReturnType<typeof postgres> | null = null;

function buildConnectionString(raw: string): string {
  return raw; // synchronous fallback — IPv4 fix applied in getDbAsync
}

/** Synchronous getter — returns cached client or creates one with raw URL.
 *  Use getDbAsync() on first call to benefit from IPv4 resolution. */
export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;

    if (!connectionString) {
      const msg =
        'DATABASE_URL is not set.\n' +
        'Add this to your hosting environment variables:\n' +
        '  DATABASE_URL=postgres://postgres.blclfnsztrxfhcfauzer:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres\n' +
        'Get [PASSWORD] from: Supabase dashboard → Project Settings → Database → Database password\n' +
        'Add the variable in: Vercel → Settings → Environment Variables  OR  Railway → Variables';
      console.error('[db]', msg);
      throw new Error(msg);
    }

    _sql = postgres(buildConnectionString(connectionString), {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: 'require',
    });
  }
  return _sql;
}

/** Async variant that pre-resolves the pooler hostname to IPv4 before
 *  creating the postgres client. Use this for DDL / migration routes. */
export async function getDbAsync(): Promise<ReturnType<typeof postgres>> {
  if (_sql) return _sql;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See db.ts for setup instructions.');
  }

  let connStr = connectionString;
  try {
    const url = new URL(connectionString);
    warnIfDirectHost(url.hostname, url.port);
    const ipv4 = await resolveIPv4(url.hostname);
    if (ipv4 !== url.hostname) {
      url.hostname = ipv4;
      connStr = url.toString();
      console.log(`[db] IPv4 forced: ${url.hostname.replace(/.*/, '<ip>')} for ${url.host}`);
    } else {
      console.warn(`[db] No IPv4 record for ${url.hostname} — connection may fail with ENETUNREACH on IPv6-only runtimes.`);
    }
  } catch { /* leave unchanged */ }

  _sql = postgres(connStr, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    ssl: 'require',
  });
  return _sql;
}

export { type Row } from 'postgres';
