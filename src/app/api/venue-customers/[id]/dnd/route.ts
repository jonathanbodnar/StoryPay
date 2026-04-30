/**
 * GET  /api/venue-customers/[id]/dnd — fetch current DND state from our DB
 * PUT  /api/venue-customers/[id]/dnd — update DND, persist locally, and push to GHL
 *
 * Only available for venues with GHL connected (ghl_connected = true).
 * DND "active" = contact has opted out / is blocked on that channel.
 * DND "inactive" = channel is open.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  getGhlToken,
  updateGhlContactDnd,
  type GhlDndSettings,
  type GhlDndChannelSetting,
  type GhlInboundDndSettings,
} from '@/lib/ghl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GHL_DND_CHANNELS = ['Call', 'Email', 'SMS', 'WhatsApp', 'GMB', 'FB'] as const;
type GhlDndChannel = (typeof GHL_DND_CHANNELS)[number];

/**
 * Derive the flat conversation_dnd_* boolean columns from GHL DND objects.
 * Accepts a permissive shape so it can be shared across modules with slightly
 * different local type aliases for the GHL DND objects.
 */
export function ghlDndToConversationFlags(
  dndSettings: Record<string, { status?: string } | null | undefined> | null | undefined,
  inboundDndSettings: { all?: { status?: string } | null } | null | undefined,
): {
  sms_dnd: boolean;
  conversation_dnd_email: boolean;
  conversation_dnd_calls: boolean;
  conversation_dnd_inbound_sms: boolean;
  conversation_dnd_all: boolean;
} {
  const emailDnd   = dndSettings?.['Email']?.status === 'active';
  const smsDnd     = dndSettings?.['SMS']?.status   === 'active';
  const callDnd    = dndSettings?.['Call']?.status  === 'active';
  const inboundDnd = inboundDndSettings?.all?.status === 'active';
  const allDnd     = emailDnd && smsDnd && callDnd && inboundDnd;
  return {
    sms_dnd: smsDnd,
    conversation_dnd_email: emailDnd,
    conversation_dnd_calls: callDnd,
    conversation_dnd_inbound_sms: inboundDnd,
    conversation_dnd_all: allDnd,
  };
}

function makeChannelSetting(active: boolean): GhlDndChannelSetting {
  return { status: active ? 'active' : 'inactive' };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data: vc, error } = await supabaseAdmin
    .from('venue_customers')
    .select('id, ghl_contact_id, ghl_dnd_settings, ghl_inbound_dnd_settings, sms_dnd')
    .eq('venue_id', venueId)
    .eq('id', id)
    .maybeSingle();

  if (error || !vc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    ghl_contact_id: vc.ghl_contact_id,
    dndSettings: (vc.ghl_dnd_settings as GhlDndSettings | null) ?? null,
    inboundDndSettings: (vc.ghl_inbound_dnd_settings as GhlInboundDndSettings | null) ?? null,
    sms_dnd: vc.sms_dnd ?? false,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await req.json() as {
    /** Map of channel → boolean (true = DND on / active, false = DND off) */
    channels?: Partial<Record<GhlDndChannel | 'all', boolean>>;
    /** Optionally pass the full dndSettings object directly */
    dndSettings?: GhlDndSettings;
    inboundDndSettings?: GhlInboundDndSettings;
  };

  // Fetch the contact to get ghl_contact_id and current venue GHL creds
  const [{ data: vc }, { data: venue }] = await Promise.all([
    supabaseAdmin
      .from('venue_customers')
      .select('id, ghl_contact_id, ghl_dnd_settings, ghl_inbound_dnd_settings, sms_dnd')
      .eq('venue_id', venueId)
      .eq('id', id)
      .maybeSingle(),
    supabaseAdmin
      .from('venues')
      .select('ghl_connected, ghl_access_token, ghl_location_id')
      .eq('id', venueId)
      .maybeSingle(),
  ]);

  if (!vc) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (!venue?.ghl_connected) return NextResponse.json({ error: 'GHL not connected' }, { status: 400 });

  // Build the new dndSettings from the `channels` shorthand if provided
  let newDndSettings: GhlDndSettings;
  let newInboundDndSettings: GhlInboundDndSettings | undefined;

  if (body.dndSettings) {
    newDndSettings = body.dndSettings;
    newInboundDndSettings = body.inboundDndSettings;
  } else if (body.channels) {
    // Start from the existing settings (preserve channels not mentioned in the update)
    const existing = (vc.ghl_dnd_settings as GhlDndSettings | null) ?? {};
    newDndSettings = { ...existing };

    for (const channel of GHL_DND_CHANNELS) {
      if (channel in body.channels) {
        newDndSettings[channel] = makeChannelSetting(body.channels[channel]!);
      }
    }

    if ('all' in body.channels) {
      // "DND All Channels" master toggle — set every outbound channel
      const allActive = body.channels.all!;
      for (const ch of GHL_DND_CHANNELS) {
        newDndSettings[ch] = makeChannelSetting(allActive);
      }
      // Also set inbound
      newInboundDndSettings = { all: makeChannelSetting(allActive) };
    } else {
      newInboundDndSettings = (vc.ghl_inbound_dnd_settings as GhlInboundDndSettings | null) ?? undefined;
    }
  } else {
    return NextResponse.json({ error: 'channels or dndSettings required' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  // 1. Persist to our DB — both ghl_dnd_settings JSONB AND the flat boolean columns
  //    that all enforcement layers (messages route, calendar-notifications, reminders) read.
  const flags = ghlDndToConversationFlags(
    newDndSettings as Record<string, { status?: string } | null | undefined>,
    newInboundDndSettings,
  );
  const dbUpdate: Record<string, unknown> = {
    ghl_dnd_settings: newDndSettings,
    ghl_inbound_dnd_settings: newInboundDndSettings ?? null,
    // Flat enforcement columns (always overwrite from GHL state)
    sms_dnd: flags.sms_dnd,
    sms_dnd_at: flags.sms_dnd ? nowIso : null,
    sms_dnd_source: flags.sms_dnd ? 'manual' : null,
    conversation_dnd_email: flags.conversation_dnd_email,
    conversation_dnd_calls: flags.conversation_dnd_calls,
    conversation_dnd_inbound_sms: flags.conversation_dnd_inbound_sms,
    conversation_dnd_all: flags.conversation_dnd_all,
    updated_at: nowIso,
  };

  const { error: dbErr } = await supabaseAdmin
    .from('venue_customers')
    .update(dbUpdate)
    .eq('venue_id', venueId)
    .eq('id', id);

  if (dbErr) {
    console.error('[dnd PUT] db update failed', dbErr);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // 2. Push to GHL (fire-and-forget style — we already saved locally)
  if (vc.ghl_contact_id && venue.ghl_access_token && venue.ghl_location_id) {
    const token = getGhlToken(venue as { ghl_access_token: string | null });
    if (token) {
      try {
        await updateGhlContactDnd(
          token,
          venue.ghl_location_id,
          vc.ghl_contact_id as string,
          newDndSettings,
          newInboundDndSettings,
        );
      } catch (ghlErr) {
        // Log but don't fail — local DB is already updated
        console.error('[dnd PUT] GHL push failed (local DB updated):', ghlErr);
        return NextResponse.json({
          success: true,
          warning: 'Saved locally but could not push to GHL. It will sync on next contact refresh.',
          dndSettings: newDndSettings,
          inboundDndSettings: newInboundDndSettings,
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    dndSettings: newDndSettings,
    inboundDndSettings: newInboundDndSettings,
  });
}
