import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { toggleLeadQualified } from '@/lib/lead-qualified-toggle';
import { syncVenueCustomerFromLeadRow } from '@/lib/venue-customer-pipeline-sync';
import { onMarketingStageChanged } from '@/lib/marketing-email-worker';
import { insertLeadActivity } from '@/lib/lead-activity';
import { broadcastStageChanged } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * POST /api/leads/[id]/toggle-qualified
 *
 * One-click "Mark Qualified" pill on conversation threads
 * (src/app/dashboard/conversations/page.tsx). Moves the lead into the
 * venue's default-pipeline "Qualified" stage, or back to "Conversations
 * Started" if it's already there. No-ops with a 422 if the lead has already
 * progressed past Qualified — enforced here (not just in the UI) so a stale
 * client can't force the lead backward out of order.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  const result = await toggleLeadQualified(venueId, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.leadEmail) {
    void syncVenueCustomerFromLeadRow(venueId, {
      email: result.leadEmail,
      pipeline_id: result.stage.pipeline_id,
      stage_id: result.stage.id,
    });
  }

  void onMarketingStageChanged(venueId, id, result.stage.id, result.previousStageId);

  void insertLeadActivity({
    venueId,
    leadId: id,
    actorMemberId: user.memberId,
    actorIsOwner: !user.memberId,
    action: 'stage_changed',
    details: {
      from_stage_id: result.previousStageId,
      to_stage_id: result.stage.id,
      to_stage_name: result.stage.name,
      via: 'mark_qualified_pill',
    },
  });

  // Broadcast to every thread tied to a venue_customer with this lead's
  // email so the pill (and the stage pill row) update live if open elsewhere.
  if (result.leadEmail) {
    void (async () => {
      try {
        const { data: vcRows } = await supabaseAdmin
          .from('venue_customers')
          .select('id')
          .eq('venue_id', venueId)
          .ilike('customer_email', result.leadEmail as string);
        const vcIds = (vcRows ?? []).map((r: { id: string }) => r.id);
        if (vcIds.length === 0) return;
        const { data: threads } = await supabaseAdmin
          .from('conversation_threads')
          .select('id, venue_customer_id')
          .eq('venue_id', venueId)
          .in('venue_customer_id', vcIds)
          .limit(50);
        for (const t of (threads ?? []) as Array<{ id: string; venue_customer_id: string }>) {
          void broadcastStageChanged({
            threadId: t.id,
            venueId,
            vcId: t.venue_customer_id,
            stageId: result.stage.id,
            stageName: result.stage.name,
            stageColor: result.stage.color,
            pipelineId: result.stage.pipeline_id,
            source: 'venue',
          });
        }
      } catch {
        // best-effort
      }
    })();
  }

  return NextResponse.json({
    ok: true,
    qualified: result.qualified,
    stage: { id: result.stage.id, name: result.stage.name, color: result.stage.color },
  });
}
