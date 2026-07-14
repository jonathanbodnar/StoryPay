import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getLeadStageAutomationInfo,
  manualEnrollLead,
  manualUnenrollLead,
} from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * Loads the lead's current stage id (scoped to the venue) and its master
 * Speed-to-Lead switch so the profile panel can show whether stage sequences
 * are globally on.
 */
async function loadContext(venueId: string, leadId: string) {
  const [{ data: lead }, { data: venue }] = await Promise.all([
    supabaseAdmin
      .from('leads')
      .select('id, stage_id')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('venues')
      .select('booking_system_enabled')
      .eq('id', venueId)
      .maybeSingle(),
  ]);
  return {
    lead: lead as { id: string; stage_id: string | null } | null,
    masterEnabled:
      (venue as { booking_system_enabled?: boolean | null } | null)?.booking_system_enabled !== false,
  };
}

// GET → the stage sequences tied to this lead's current stage + enrollment state.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  const { lead, masterEnabled } = await loadContext(venueId, id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const automations = await getLeadStageAutomationInfo(venueId, id, lead.stage_id);
  return NextResponse.json({ masterEnabled, stageId: lead.stage_id, automations });
}

// POST { automationId, action: 'enroll' | 'unenroll' } → manual override.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  let body: { automationId?: string; action?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const automationId = typeof body.automationId === 'string' ? body.automationId : '';
  const action = body.action;
  if (!automationId || (action !== 'enroll' && action !== 'unenroll')) {
    return NextResponse.json({ error: 'automationId and a valid action are required' }, { status: 400 });
  }

  const { lead } = await loadContext(venueId, id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const ok =
    action === 'enroll'
      ? await manualEnrollLead(venueId, id, automationId)
      : await manualUnenrollLead(venueId, id, automationId);

  if (!ok) return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 });

  const automations = await getLeadStageAutomationInfo(venueId, id, lead.stage_id);
  return NextResponse.json({ ok: true, automations });
}
