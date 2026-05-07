/**
 * Self-healing schema ensurer for the admin team management feature.
 *
 * Migration 113 adds first_name / last_name / avatar_url / admin_tabs_allowed /
 * is_super_admin columns to public.support_team_members.
 *
 * Strategy:
 *   1. Probe via supabase-js (which always works in production because it uses
 *      SUPABASE_SERVICE_ROLE_KEY, not DATABASE_URL). If the new columns are
 *      already present, we're done — return silently.
 *   2. Only if the probe shows the columns are missing do we attempt the DDL
 *      via the direct postgres connection (DATABASE_URL).
 *
 * This means once the migration has been applied (either by this auto-heal
 * or manually via the Supabase SQL editor), subsequent calls are completely
 * silent and never touch DATABASE_URL — so a stale/wrong DATABASE_URL no
 * longer breaks the team management UI.
 */

import { supabaseAdmin } from './supabase';

let cachedOk: boolean | null = null;
let pendingProbe: Promise<boolean> | null = null;

async function probeColumnsExist(): Promise<boolean> {
  // Light SELECT touching the new columns. supabase-js raises a 42703
  // ("column does not exist") error if any of them are missing.
  const { error } = await supabaseAdmin
    .from('support_team_members')
    .select('id, first_name, last_name, avatar_url, admin_tabs_allowed, is_super_admin')
    .limit(1);
  if (!error) return true;
  // PostgREST surfaces the underlying Postgres error code as `code` (42703).
  const code = (error as { code?: string }).code;
  if (code === '42703') return false;
  // Some other error (RLS, network, etc.) — be conservative and say "looks ok"
  // so we don't try to ALTER TABLE on every request.
  return true;
}

async function attemptDdl(): Promise<void> {
  // Only imported lazily so a missing DATABASE_URL or postgres dependency
  // never breaks the success path above.
  const { getDbAsync } = await import('./db');
  const sql = await getDbAsync();
  await sql.unsafe(`
    ALTER TABLE public.support_team_members
      ADD COLUMN IF NOT EXISTS first_name         text,
      ADD COLUMN IF NOT EXISTS last_name          text,
      ADD COLUMN IF NOT EXISTS avatar_url         text,
      ADD COLUMN IF NOT EXISTS admin_tabs_allowed jsonb,
      ADD COLUMN IF NOT EXISTS is_super_admin     boolean NOT NULL DEFAULT false;

    UPDATE public.support_team_members
    SET first_name = COALESCE(NULLIF(split_part(name, ' ', 1), ''), name),
        last_name  = NULLIF(regexp_replace(name, '^\\S+\\s*', ''), '')
    WHERE first_name IS NULL;

    NOTIFY pgrst, 'reload schema';
  `);
}

/**
 * Ensures migration 113 columns exist on support_team_members. Idempotent and
 * cached for the lifetime of the process. If the columns are already present,
 * this is a single cached round-trip per request — never throws.
 */
export async function ensureAdminTeamSchema(): Promise<void> {
  if (cachedOk) return;
  if (!pendingProbe) {
    pendingProbe = (async () => {
      const ok = await probeColumnsExist();
      if (ok) { cachedOk = true; return true; }
      try {
        await attemptDdl();
        cachedOk = true;
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Re-probe in case some sibling request applied the schema while we were trying.
        const okAfter = await probeColumnsExist().catch(() => false);
        if (okAfter) { cachedOk = true; return true; }
        console.error('[admin-team-schema] DDL failed and columns still missing:', msg);
        // Reset so a future request retries (e.g. after the user applies the SQL manually).
        pendingProbe = null;
        throw new Error(
          `Database schema is missing required columns and auto-fix could not run ` +
          `(${msg}). Open your Supabase SQL editor and run migration 113 manually ` +
          `(see migrations/113_admin_team_members.sql).`,
        );
      }
    })();
  }
  await pendingProbe;
}
