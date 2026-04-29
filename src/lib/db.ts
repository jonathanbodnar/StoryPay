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

// Railway (and some other hosts) can't reach Supabase's pooler over IPv6.
// Resolve the hostname to an IPv4 address first so the postgres driver
// never attempts an IPv6 TCP connection.
async function resolveIPv4(host: string): Promise<string> {
  try {
    const { address } = await lookup(host, { family: 4 });
    return address;
  } catch {
    return host;
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
    const ipv4 = await resolveIPv4(url.hostname);
    if (ipv4 !== url.hostname) {
      url.hostname = ipv4;
      connStr = url.toString();
      console.log(`[db] IPv4 forced: ${ipv4}`);
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
