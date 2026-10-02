/**
 * Support agent password hashing + simple session helpers.
 *
 * Support agents log in to /admin/support with email + password. Their session
 * cookie is a signed JWT carrying { sub: support_team_members.id, role }.
 *
 * `ADMIN_SECRET` doubles as the JWT signing secret — no extra env var needed.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';
import { verifyMasterAdminToken } from '@/lib/admin-token';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveAllowedAdminTabs } from '@/lib/admin-tabs-registry';
import { ADMIN_REQUEST_HEADER, adminRequestAllowed } from '@/lib/admin-route-tabs';

export const SUPPORT_SESSION_COOKIE = 'support_session';
// Concierge/support team sessions last a full week of inactivity before
// requiring re-login — was 12h, which forced the team to re-authenticate
// multiple times a day. Manual logout still clears the cookie immediately.
const SESSION_TTL_HOURS = 24 * 7;

export type SupportRole = 'support_agent' | 'support_admin';

export interface SupportSessionPayload {
  sub:   string;       // support_team_members.id
  email: string;
  name:  string;
  role:  SupportRole;
}

function jwtSecret(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s) throw new Error('ADMIN_SECRET is not set');
  return s;
}

export async function hashSupportPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifySupportPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSupportSession(payload: SupportSessionPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: `${SESSION_TTL_HOURS}h` });
}

export function verifySupportSession(token: string): SupportSessionPayload | null {
  try {
    const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as SupportSessionPayload & { iat?: number; exp?: number };
    if (!decoded?.sub || !decoded?.role) return null;
    return { sub: decoded.sub, email: decoded.email, name: decoded.name, role: decoded.role };
  } catch {
    return null;
  }
}

/**
 * Read the current support agent session from cookies, if any.
 * Returns null when no session, or when token is invalid/expired.
 */
export async function getSupportSession(): Promise<SupportSessionPayload | null> {
  const c = await cookies();
  const token = c.get(SUPPORT_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySupportSession(token);
}

/**
 * True if either the master super admin OR an active support agent is logged
 * in. A member who was switched off loses access at once (their signed session
 * lasts 12 hours), and one who isn't a full admin only makes changes behind
 * their tabs (src/lib/admin-route-tabs.ts), as everywhere in the admin.
 */
export async function verifySupportAccess(): Promise<{ isSuperAdmin: boolean; agent: SupportSessionPayload | null }> {
  const c = await cookies();
  const adminToken = c.get('admin_token')?.value;
  const isSuperAdmin = verifyMasterAdminToken(adminToken);
  if (isSuperAdmin) return { isSuperAdmin, agent: null };

  const session = await getSupportSession();
  if (!session) return { isSuperAdmin, agent: null };
  const { data: member } = await supabaseAdmin
    .from('support_team_members')
    .select('active, is_super_admin, admin_tabs_allowed')
    .eq('id', session.sub)
    .maybeSingle();
  if (!member || member.active === false) return { isSuperAdmin, agent: null };
  const request = (await headers()).get(ADMIN_REQUEST_HEADER) ?? '';
  const adminApi = (request.split(' ')[1] ?? '').startsWith('/api/admin/');
  if (adminApi && member.is_super_admin !== true && !adminRequestAllowed(request, resolveAllowedAdminTabs(false, member.admin_tabs_allowed))) {
    return { isSuperAdmin, agent: null };
  }
  return { isSuperAdmin, agent: session };
}
