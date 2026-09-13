import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase';
import {
  resolveCoupleWeddingAccess,
  type CoupleWeddingRow,
  type WeddingAccessLevel,
} from '@/lib/couple-weddings';

/**
 * Resolve Supabase Auth user from Authorization: Bearer <access_token> (couple / bride sessions).
 */
export async function getCoupleAuthUser(request: NextRequest): Promise<User | null> {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  const jwt = auth.slice(7).trim();
  if (!jwt) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}

export interface CoupleWeddingContext {
  user: User;
  wedding: CoupleWeddingRow;
  access: WeddingAccessLevel;
  collaboratorId: string | null;
}

/**
 * The single gate every couple Wedding Planner API route goes through. It
 * resolves the caller's active wedding + their access level (owner / edit /
 * view) and enforces the shared access rules in ONE place so no route can drift:
 *
 *   - opts.write     : reject 'view' collaborators (read-only) with 403.
 *   - opts.ownerOnly : reject ANY collaborator (edit or view) with 403 — this is
 *                      how Budget stays private to the owning couple.
 *   - opts.requireLinked : the wedding must be actively linked (else 409), which
 *                          matches the previous `status !== 'linked'` guards.
 *
 * On success returns { ok:true, ctx }; on failure returns { ok:false, res } with
 * a ready-to-return NextResponse so callers stay tiny:
 *
 *   const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
 *   if (!gate.ok) return gate.res;
 *   const { wedding, access } = gate.ctx;
 */
export async function resolveCoupleWeddingContext(
  request: NextRequest,
  opts: { write?: boolean; ownerOnly?: boolean; requireLinked?: boolean } = {},
): Promise<{ ok: true; ctx: CoupleWeddingContext } | { ok: false; res: NextResponse }> {
  const user = await getCoupleAuthUser(request);
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const resolved = await resolveCoupleWeddingAccess(user.id);
  if (!resolved) {
    return { ok: false, res: NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 }) };
  }

  const { wedding, access, collaboratorId } = resolved;

  if (opts.requireLinked && wedding.status !== 'linked') {
    return { ok: false, res: NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 }) };
  }
  if (opts.ownerOnly && access !== 'owner') {
    return {
      ok: false,
      res: NextResponse.json({ error: 'This is private to the couple.' }, { status: 403 }),
    };
  }
  if (opts.write && access === 'view') {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Your access is view-only.' }, { status: 403 }),
    };
  }

  return { ok: true, ctx: { user, wedding, access, collaboratorId } };
}
