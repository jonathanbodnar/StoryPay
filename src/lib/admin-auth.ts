import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { getSupportSession } from '@/lib/support/auth';
import { verifyMasterAdminToken } from '@/lib/admin-token';
import { resolveAllowedAdminTabs } from '@/lib/admin-tabs-registry';
import { ADMIN_REQUEST_HEADER, adminRequestAllowed } from '@/lib/admin-route-tabs';

/**
 * Returns true iff the caller is authenticated as an admin — EITHER the
 * master env-based super admin OR an active database-stored team member.
 *
 * Originally this only validated the master admin token, which meant that
 * after a team-member feature was added (admin-team-management), every
 * existing /api/admin/* route silently rejected team-member sessions even
 * though they're legitimate admins. This is the canonical "is the request
 * coming from someone allowed in /admin?" check.
 *
 * For tab-level gating (e.g. "this route powers Couples — does this user
 * have the 'couples' tab enabled?"), use {@link hasAdminTabAccess} from
 * `@/lib/admin-identity` instead.
 */
export async function verifyAdminCookie(): Promise<boolean> {
  const c = await cookies();

  const masterToken = c.get('admin_token')?.value;
  if (verifyMasterAdminToken(masterToken)) {
    return true;
  }

  const session = await getSupportSession();
  if (!session) return false;

  const { data } = await supabaseAdmin
    .from('support_team_members')
    .select('id, active, is_super_admin, admin_tabs_allowed')
    .eq('id', session.sub)
    .maybeSingle();

  if (!data || data.active === false) return false;
  return teamMemberMayMakeRequest(data.is_super_admin === true, resolveAllowedAdminTabs(false, data.admin_tabs_allowed));
}

/**
 * A full team admin can do anything; anyone else can read, and change only
 * what their tabs cover (src/lib/admin-route-tabs.ts).
 */
export async function teamMemberMayMakeRequest(isSuperAdmin: boolean, tabs: ReadonlySet<string>): Promise<boolean> {
  if (isSuperAdmin) return true;
  return adminRequestAllowed((await headers()).get(ADMIN_REQUEST_HEADER), tabs);
}

/**
 * Stricter guard for routes that should only be runnable by the master
 * env-based super admin (e.g. running raw SQL migrations).
 */
export async function verifyMasterAdminOnly(): Promise<boolean> {
  const c = await cookies();
  const t = c.get('admin_token')?.value;
  return verifyMasterAdminToken(t);
}
