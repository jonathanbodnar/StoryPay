import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { getSupportSession } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const support = await getSupportSession();
  const isSuperAdmin = support ? false : await verifyAdminCookie();

  if (!support && !isSuperAdmin) {
    return NextResponse.json({ authed: false }, { status: 200 });
  }

  return NextResponse.json({
    authed: true,
    superAdmin: isSuperAdmin,
    member: support ? {
      id:    support.sub,
      email: support.email,
      name:  support.name,
      role:  support.role,
    } : null,
  });
}
