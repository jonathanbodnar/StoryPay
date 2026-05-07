/**
 * Self-healing schema ensurer for the admin team management feature.
 *
 * Migration 113 adds first_name / last_name / avatar_url / admin_tabs_allowed /
 * is_super_admin columns to public.support_team_members. If somebody pushes
 * the code before applying the migration, every team-members API call would
 * fail with "column does not exist" errors.
 *
 * Rather than force the user to manually run SQL, we lazily ensure the schema
 * is up to date the first time any team-members route is called. The
 * underlying ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent, and we
 * cache the result for the lifetime of the process so subsequent calls are
 * no-ops.
 */

import { getDbAsync } from './db';

let ensured: Promise<void> | null = null;

const ENSURE_SQL = `
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
`;

async function runEnsure(): Promise<void> {
  try {
    const sql = await getDbAsync();
    await sql.unsafe(ENSURE_SQL);
    console.log('[admin-team-schema] columns ensured');
  } catch (err) {
    // Reset the cached promise on failure so the next request retries.
    ensured = null;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin-team-schema] ensure failed:', msg);
    throw err;
  }
}

/**
 * Ensures migration 113 columns exist on support_team_members. Safe to call
 * before every request — only runs the DDL once per process. Throws if the
 * underlying connection cannot be established.
 */
export function ensureAdminTeamSchema(): Promise<void> {
  if (!ensured) ensured = runEnsure();
  return ensured;
}
