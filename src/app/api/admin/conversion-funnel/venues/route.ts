import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { loadFunnelData } from '@/lib/funnel-data';
import {
  FUNNEL_STAGES,
  venueStageReached,
  furthestStage,
  type FunnelStageKey,
} from '@/lib/funnel-stage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyDashboardRead(): Promise<boolean> {
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) return true;
  return id.allowedTabs.has('dashboard');
}

/**
 * GET /api/admin/conversion-funnel/venues?stage=card_shown&from=&to=
 *
 * Drill-down for a single funnel ribbon: returns the venues that REACHED (at
 * least) the requested stage, within the same signup date window the funnel
 * uses. The list length equals the ribbon's count so the modal and the bar
 * always agree. Each venue also carries its furthest stage so the admin can
 * see exactly where it stalled.
 */
export async function GET(req: NextRequest) {
  if (!(await verifyDashboardRead())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const stage = (sp.get('stage') || '') as FunnelStageKey;
  const stageDef = FUNNEL_STAGES.find((s) => s.key === stage);
  if (!stageDef) {
    return NextResponse.json({ error: 'Unknown stage' }, { status: 400 });
  }

  const { venues, evSets } = await loadFunnelData(sp.get('from'), sp.get('to'));

  const list = venues
    .filter((v) => venueStageReached(v, evSets)[stage])
    .map((v) => {
      const furthest = furthestStage(v, evSets);
      return {
        id: v.id,
        name: v.name,
        email: v.email,
        created_at: v.created_at,
        status: v.directory_subscription_status,
        furthestKey: furthest.key,
        furthestLabel: furthest.label,
      };
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return NextResponse.json({ stage, label: stageDef.label, count: list.length, venues: list });
}
