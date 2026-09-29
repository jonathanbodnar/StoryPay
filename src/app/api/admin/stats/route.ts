import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { loadAdminDashboardStats } from '@/lib/admin-dashboard-stats';

/**
 * Master super admin OR any team member with `dashboard` tab access may read
 * the platform stats. (Older versions required the master admin_token; that
 * locked out invited team members and made the dashboard fail silently.)
 */
async function verifyDashboardRead(): Promise<boolean> {
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) return true;
  return id.allowedTabs.has('dashboard');
}

export async function GET(request: NextRequest) {
  if (!(await verifyDashboardRead())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = request.nextUrl;
  return NextResponse.json(await loadAdminDashboardStats(searchParams.get('from'), searchParams.get('to')));
}
