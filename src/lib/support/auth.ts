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
import { cookies } from 'next/headers';

export const SUPPORT_SESSION_COOKIE = 'support_session';
const SESSION_TTL_HOURS = 12;

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
    const decoded = jwt.verify(token, jwtSecret()) as SupportSessionPayload & { iat?: number; exp?: number };
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

/** True if either the master super admin OR a support agent is logged in. */
export async function verifySupportAccess(): Promise<{ isSuperAdmin: boolean; agent: SupportSessionPayload | null }> {
  const c = await cookies();
  const adminToken = c.get('admin_token')?.value;
  const isSuperAdmin = Boolean(adminToken && adminToken === process.env.ADMIN_SECRET);

  const agent = isSuperAdmin ? null : await getSupportSession();
  return { isSuperAdmin, agent };
}
