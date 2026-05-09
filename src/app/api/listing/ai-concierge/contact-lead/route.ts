/**
 * GET  /api/listing/ai-concierge/contact-lead?vcId={id}|email={email}
 * POST /api/listing/ai-concierge/contact-lead    body: { vcId }
 *
 * GET returns:
 *   {
 *     lead:        { id, ai_state, ai_next_send_at, ... } | null,
 *     eligible:    boolean,    // venue can run AI Concierge
 *     enabled:     boolean,    // venue has AI turned on
 *     vcId:        string | null,
 *     hasContact:  boolean,    // venue_customer exists for this email/vcId
 *   }
 *
 * POST activates AI Concierge for a venue_customer:
 *   - Creates a lead from the venue_customer if missing
 *   - Sets ai_state → 'ai_active'
 *   - Returns the fresh lead snapshot
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { setLeadAiState } from '@/lib/ai-concierge/state-control';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

interface LeadSnap {
  id: string;
  ai_state: string | null;
  ai_next_send_at: string | null;
  ai_expires_at: string | null;
  ai_attempt_count: number;
  ai_first_activated_at: string | null;
}

interface VenuePlanRow {
  feature_flags: Record<string, unknown> | null;
  is_legacy: boolean | null;
  name: string | null;
  slug: string | null;
}

async function loadVenueAiContext(venueId: string) {
  const { data: v } = await supabaseAdmin
    .from('venues')
    .select('id, ai_concierge_enabled, directory_addon_concierge, a2p_verified, directory_plan_id')
    .eq('id', venueId)
    .maybeSingle();

  let plan: VenuePlanRow | null = null;
  if (v?.directory_plan_id) {
    const { data: p } = await supabaseAdmin
      .from('directory_plans')
      .select('feature_flags, is_legacy, name, slug')
      .eq('id', v.directory_plan_id)
      .maybeSingle();
    plan = p as VenuePlanRow | null;
  }

  const flags = (plan?.feature_flags ?? {}) as Record<string, unknown>;
  const planIncludesConcierge = flags['addon_concierge_included'] === true;
  const isLegacyPlan = plan?.is_legacy === true
    || String(plan?.name ?? '').toLowerCase().includes('legacy')
    || String(plan?.slug ?? '').toLowerCase().includes('legacy');
  const addon = v?.directory_addon_concierge === true || planIncludesConcierge || isLegacyPlan;
  const a2p = v?.a2p_verified === true;
  const enabled = v?.ai_concierge_enabled === true;
  // Eligible = has the addon (a2p only required for actual SMS sending, not button visibility)
  const eligible = addon;
  return { enabled, eligible, a2p };
}

async function findVenueCustomer(args: {
  venueId: string;
  vcId?: string | null;
  email?: string | null;
}): Promise<{ id: string; customer_email: string | null; first_name: string | null; last_name: string | null; phone: string | null; pipeline_id: string | null; stage_id: string | null } | null> {
  const { venueId, vcId, email } = args;
  if (vcId) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, pipeline_id, stage_id, venue_id')
      .eq('id', vcId)
      .maybeSingle();
    // Allow even when venue_id mismatches (legacy GHL clients) — we still return it
    if (data) return data;
  }
  if (email) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, pipeline_id, stage_id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function findLeadForContact(args: {
  venueId: string;
  email: string | null;
  phone: string | null;
}): Promise<LeadSnap | null> {
  const { venueId, email, phone } = args;
  let query = supabaseAdmin
    .from('leads')
    .select('id, ai_state, ai_next_send_at, ai_expires_at, ai_attempt_count, ai_first_activated_at, email, phone, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (email) query = query.ilike('email', email);
  const { data: byEmail } = await query.maybeSingle();
  if (byEmail) {
    return {
      id: byEmail.id as string,
      ai_state: byEmail.ai_state as string | null,
      ai_next_send_at: byEmail.ai_next_send_at as string | null,
      ai_expires_at: byEmail.ai_expires_at as string | null,
      ai_attempt_count: (byEmail.ai_attempt_count as number) ?? 0,
      ai_first_activated_at: byEmail.ai_first_activated_at as string | null,
    };
  }
  if (phone) {
    const cleaned = phone.replace(/[^\d]/g, '').slice(-10);
    if (cleaned.length >= 7) {
      const { data: byPhone } = await supabaseAdmin
        .from('leads')
        .select('id, ai_state, ai_next_send_at, ai_expires_at, ai_attempt_count, ai_first_activated_at')
        .eq('venue_id', venueId)
        .ilike('phone', `%${cleaned}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byPhone) {
        return {
          id: byPhone.id as string,
          ai_state: byPhone.ai_state as string | null,
          ai_next_send_at: byPhone.ai_next_send_at as string | null,
          ai_expires_at: byPhone.ai_expires_at as string | null,
          ai_attempt_count: (byPhone.ai_attempt_count as number) ?? 0,
          ai_first_activated_at: byPhone.ai_first_activated_at as string | null,
        };
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const vcId = req.nextUrl.searchParams.get('vcId')?.trim() || null;
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() || null;

  if (!vcId && !email) {
    return NextResponse.json({ error: 'Provide vcId or email' }, { status: 400 });
  }

  const ctx = await loadVenueAiContext(venueId);

  const vc = await findVenueCustomer({ venueId, vcId, email });
  const effectiveEmail = (vc?.customer_email || email || '').trim().toLowerCase() || null;
  const effectivePhone = vc?.phone || null;

  const lead = await findLeadForContact({
    venueId,
    email: effectiveEmail,
    phone: effectivePhone,
  });

  return NextResponse.json({
    lead,
    eligible: ctx.eligible,
    enabled: ctx.enabled,
    vcId: vc?.id ?? null,
    hasContact: !!vc,
  });
}

export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { vcId?: string };
  if (!body.vcId) return NextResponse.json({ error: 'vcId is required' }, { status: 400 });

  const ctx = await loadVenueAiContext(venueId);
  if (!ctx.eligible) {
    return NextResponse.json({ error: 'AI Concierge addon is not active for this venue' }, { status: 403 });
  }

  const vc = await findVenueCustomer({ venueId, vcId: body.vcId });
  if (!vc) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const email = (vc.customer_email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Contact has no email' }, { status: 400 });

  // 1. Find or create the lead
  let lead = await findLeadForContact({ venueId, email, phone: vc.phone });
  if (!lead) {
    // Create a minimal lead from the venue_customer
    const fn = (vc.first_name || '').trim();
    const ln = (vc.last_name || '').trim();
    const name = [fn, ln].filter(Boolean).join(' ') || email;
    const now = new Date().toISOString();

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('leads')
      .insert({
        venue_id:    venueId,
        name,
        first_name:  fn || null,
        last_name:   ln || null,
        email,
        phone:       vc.phone || '',
        source:      'manual_ai_activate',
        status:      'new',
        pipeline_id: vc.pipeline_id,
        stage_id:    vc.stage_id,
        position:    0,
        updated_at:  now,
      })
      .select('id, ai_state, ai_next_send_at, ai_expires_at, ai_attempt_count, ai_first_activated_at')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json({ error: insertErr?.message ?? 'Failed to create lead' }, { status: 500 });
    }
    lead = {
      id: inserted.id as string,
      ai_state: inserted.ai_state as string | null,
      ai_next_send_at: inserted.ai_next_send_at as string | null,
      ai_expires_at: inserted.ai_expires_at as string | null,
      ai_attempt_count: 0,
      ai_first_activated_at: inserted.ai_first_activated_at as string | null,
    };
  }

  // 2. Activate AI on the lead
  const result = await setLeadAiState({
    leadId:      lead.id,
    venueId,
    newState:    'ai_active',
    triggeredBy: 'human',
    reason:      'manual_activate_from_contact_profile',
  });

  if (!result.ok && !result.noop) {
    return NextResponse.json({ error: result.error ?? 'Failed to activate AI' }, { status: 500 });
  }

  // 3. Return fresh snapshot
  const fresh = await findLeadForContact({ venueId, email, phone: vc.phone });
  return NextResponse.json({
    ok: true,
    lead: fresh,
    eligible: ctx.eligible,
    enabled: ctx.enabled,
    vcId: vc.id,
    hasContact: true,
  });
}
