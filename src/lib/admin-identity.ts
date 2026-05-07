/**
 * Unified admin identity resolution.
 *
 * Two ways to be a super admin / staff:
 *
 *   1. Master super admin — env-based (ADMIN_EMAIL / ADMIN_PASSWORD).
 *      Always has full access to every tab including the team management page.
 *      Identified by `admin_token` cookie matching ADMIN_SECRET. No DB row.
 *
 *   2. Team member — DB row in support_team_members with is_super_admin=true
 *      OR with admin_tabs_allowed entries. Logs in via the same /api/admin/login
 *      route. Session is the support_session JWT (12h TTL).
 *
 * `getAdminIdentity()` is the canonical resolver — call it from any admin API
 * route or layout to get the current identity + their allowed tabs.
 */

import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { getSupportSession } from '@/lib/support/auth';
import { resolveAllowedAdminTabs, ADMIN_TAB_KEY_SET } from '@/lib/admin-tabs-registry';

export interface AdminIdentity {
  /** True iff the master env-based super admin is logged in (has full access). */
  isMasterSuperAdmin: boolean;
  /** Logged-in team member row (when not master super admin). */
  member: {
    id: string;
    email: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: 'support_agent' | 'support_admin';
    is_super_admin: boolean;
  } | null;
  /** Set of tab keys the identity can access. */
  allowedTabs: Set<string>;
  /** True iff the identity may manage other team members and edit roles. */
  canManageTeam: boolean;
}

const EMPTY_IDENTITY: AdminIdentity = {
  isMasterSuperAdmin: false,
  member: null,
  allowedTabs: new Set(),
  canManageTeam: false,
};

export async function getAdminIdentity(): Promise<AdminIdentity> {
  const c = await cookies();

  // Master super admin (env-based) — full access.
  const adminToken = c.get('admin_token')?.value;
  if (adminToken && process.env.ADMIN_SECRET && adminToken === process.env.ADMIN_SECRET) {
    return {
      isMasterSuperAdmin: true,
      member: null,
      allowedTabs: new Set(ADMIN_TAB_KEY_SET),
      canManageTeam: true,
    };
  }

  // Team member — JWT session.
  const session = await getSupportSession();
  if (!session) return EMPTY_IDENTITY;

  const { data: row } = await supabaseAdmin
    .from('support_team_members')
    .select(
      'id, email, name, first_name, last_name, avatar_url, role, active, is_super_admin, admin_tabs_allowed',
    )
    .eq('id', session.sub)
    .maybeSingle();

  if (!row || row.active === false) return EMPTY_IDENTITY;

  const isTeamSuperAdmin = row.is_super_admin === true;
  const allowed = resolveAllowedAdminTabs(
    isTeamSuperAdmin,
    (row.admin_tabs_allowed as Record<string, boolean> | null) ?? null,
  );

  return {
    isMasterSuperAdmin: false,
    member: {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      first_name: (row.first_name as string | null) ?? null,
      last_name: (row.last_name as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      role: (row.role as 'support_agent' | 'support_admin') ?? 'support_agent',
      is_super_admin: isTeamSuperAdmin,
    },
    allowedTabs: allowed,
    canManageTeam: isTeamSuperAdmin,
  };
}

/** Quick guard for API routes — returns true iff the caller has admin access. */
export async function hasAdminAccess(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!id.member;
}

/** Tab-level guard. Used by API routes that back a specific tab. */
export async function hasAdminTabAccess(tabKey: string): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.allowedTabs.has(tabKey);
}

/** Returns identity if admin, else null. Convenience wrapper. */
export async function requireAdmin(): Promise<AdminIdentity | null> {
  const id = await getAdminIdentity();
  if (!id.isMasterSuperAdmin && !id.member) return null;
  return id;
}
