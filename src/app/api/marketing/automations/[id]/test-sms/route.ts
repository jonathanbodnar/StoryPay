import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/marketing/automations/[id]/test-sms
// Body: { stepOrder: number; toPhone: string; body?: string; mediaUrls?: string[] }
// Sends a test SMS to the supplied phone number with the step's current body template.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { stepOrder?: number; toPhone?: string; body?: string; mediaUrls?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { stepOrder, toPhone, mediaUrls } = body;
  if (typeof stepOrder !== 'number') return NextResponse.json({ error: 'stepOrder required' }, { status: 400 });
  if (!toPhone?.trim()) return NextResponse.json({ error: 'toPhone required' }, { status: 400 });

  const rawPhone = normalizePhone(toPhone.trim());
  if (!rawPhone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });

  // Load the step config
  const { data: step } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('step_type, config_json')
    .eq('automation_id', id)
    .eq('step_order', stepOrder)
    .maybeSingle();
  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  if (step.step_type !== 'send_sms') return NextResponse.json({ error: 'Step is not a send_sms step' }, { status: 400 });

  // Use caller-supplied body (live editor value) or fall back to saved config
  const cfg = step.config_json as { body?: string; media_urls?: string[] };
  const smsBody = (body.body?.trim() || String(cfg.body || '').trim());
  if (!smsBody) return NextResponse.json({ error: 'SMS body is empty' }, { status: 400 });

  // Merge placeholder values so shortcodes don't appear literally in the test
  const preview = smsBody
    .replace(/\{\{first_name\}\}/g, 'Preview')
    .replace(/\{\{last_name\}\}/g, 'Contact')
    .replace(/\{\{venue_name\}\}/g, 'Your Venue')
    .replace(/\{\{wedding_date\}\}/g, 'TBD')
    .replace(/\{\{trigger_link\.[^}]+\}\}/g, '[link]');

  // Load venue GHL credentials
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, ghl_access_token, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();

  if (!(venue as { ghl_connected?: boolean } | null)?.ghl_connected) {
    return NextResponse.json({ error: 'GHL not connected for this venue' }, { status: 400 });
  }
  const token = getGhlToken(venue as { ghl_access_token?: string | null });
  const loc = venue?.ghl_location_id as string | null;
  if (!token || !loc) return NextResponse.json({ error: 'GHL not configured' }, { status: 400 });

  try {
    // Find or create GHL contact by phone — use a placeholder name for the test
    const contactId = await findOrCreateContact(token, loc, {
      phone: rawPhone,
      firstName: 'Test',
      lastName: 'SMS',
    });
    if (!contactId) return NextResponse.json({ error: 'Could not resolve GHL contact' }, { status: 500 });

    // Merge caller-supplied media urls with the saved step media urls (deduplicated)
    const effectiveMedia = Array.from(new Set([
      ...(mediaUrls ?? []),
      ...(cfg.media_urls ?? []),
    ])).slice(0, 3);

    await sendSms(token, loc, contactId, preview, effectiveMedia.length ? effectiveMedia : undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMS send failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ sent: true, to: rawPhone });
}
