/**
 * Bootstraps a synthetic "Super Admin" row in support_team_members so the
 * master super admin can act in the support inbox immediately, without
 * having to first create a real support team member.
 *
 * The row uses a deterministic UUID so callers can rely on it across
 * requests/processes. The password hash is a non-bcrypt sentinel — no
 * password ever validates against it, which means nobody can log in via
 * /admin/support/login as this synthetic user. It exists purely to
 * satisfy attribution constraints on conversation_messages.
 */

import { supabaseAdmin } from '@/lib/supabase';

export const SUPER_ADMIN_SUPPORT_USER_ID = '00000000-0000-0000-0000-0000000000a1';
export const SUPER_ADMIN_SUPPORT_EMAIL   = 'super-admin@storyvenue.internal';
export const SUPER_ADMIN_SUPPORT_NAME    = 'Super Admin';
export const SUPER_ADMIN_SUPPORT_ROLE    = 'support_admin' as const;

let ensuredOnce = false;

/**
 * Idempotently ensure the super-admin support_team_members row exists.
 * Cheap (one upsert) and we cache success in-process to avoid round-trips
 * on every authenticated request.
 *
 * Returns the canonical identity payload for use in `/me`-style responses.
 */
export async function ensureSuperAdminSupportMember(): Promise<{
  id:    string;
  email: string;
  name:  string;
  role:  'support_admin';
}> {
  if (!ensuredOnce) {
    try {
      // upsert on id — first call inserts, subsequent calls are a no-op-ish
      // update of timestamps. password_hash is intentionally a sentinel so
      // bcrypt.compare always fails — this row can never log in.
      await supabaseAdmin
        .from('support_team_members')
        .upsert(
          {
            id:            SUPER_ADMIN_SUPPORT_USER_ID,
            email:         SUPER_ADMIN_SUPPORT_EMAIL,
            name:          SUPER_ADMIN_SUPPORT_NAME,
            password_hash: 'disabled-super-admin-sentinel',
            role:          SUPER_ADMIN_SUPPORT_ROLE,
            active:        true,
          },
          { onConflict: 'id' },
        );
      ensuredOnce = true;
    } catch (err) {
      console.warn('[super-admin-member] ensure failed (will retry next call)', err);
    }
  }
  return {
    id:    SUPER_ADMIN_SUPPORT_USER_ID,
    email: SUPER_ADMIN_SUPPORT_EMAIL,
    name:  SUPER_ADMIN_SUPPORT_NAME,
    role:  SUPER_ADMIN_SUPPORT_ROLE,
  };
}
