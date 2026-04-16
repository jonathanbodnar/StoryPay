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

let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;   // Vercel sometimes injects this name

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

    _sql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,   // required for PgBouncer transaction mode
      ssl: 'require',   // Supabase requires SSL on all connections
    });
  }
  return _sql;
}

export { type Row } from 'postgres';
