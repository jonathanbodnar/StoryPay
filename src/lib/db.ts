/**
 * Direct PostgreSQL connection that bypasses PostgREST entirely.
 *
 * supabase-js routes all queries through PostgREST (the REST API layer).
 * PostgREST has an in-memory schema cache that only picks up new tables
 * after a DDL event or restart — this causes "table not found in schema cache"
 * errors for any table created after PostgREST last loaded.
 *
 * This client connects directly to the Postgres wire protocol, so it works
 * immediately with any table regardless of PostgREST cache state.
 *
 * Required env var: DATABASE_URL (Supabase → Project Settings → Database → Connection string → URI)
 * Format: postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
 */

import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. ' +
        'Add it from: Supabase dashboard → Project Settings → Database → ' +
        'Connection string → URI (use the pooler/transaction URL on port 6543).'
      );
    }
    _sql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required for PgBouncer transaction mode
    });
  }
  return _sql;
}

export { type Row } from 'postgres';
