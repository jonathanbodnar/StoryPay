import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { getSupportSession } from '@/lib/support/auth';
import { ensureSuperAdminSupportMember } from '@/lib/support/super-admin-member';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const support = await getSupportSession();
  const isSuperAdmin = support ? false : await verifyAdminCookie();

  if (!support && !isSuperAdmin) {
    return NextResponse.json({ authed: false }, { status: 200 });
  }

  // Real support agent session takes precedence over synthetic super-admin.
  if (support) {
    return NextResponse.json({
      authed:     true,
      superAdmin: false,
      member: {
        id:    support.sub,
        email: support.email,
        name:  support.name,
        role:  support.role,
      },
    });
  }

  // Super admin: bootstrap (or reuse) a deterministic support_team_members
  // row so the rest of the support stack can attribute messages to a real
  // FK target. The synthetic row's password is sentinel — it can never
  // log in; it only exists to satisfy attribution.
  const sa = await ensureSuperAdminSupportMember();
  return NextResponse.json({
    authed:     true,
    superAdmin: true,
    member: {
      id:    sa.id,
      email: sa.email,
      name:  sa.name,
      role:  sa.role,
    },
  });
}
