import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_calendar_notifications')
    .select('*')
    .eq('venue_id', venueId)
    .order('notification_type')
    .order('channel');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PUT(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows: Array<{
    notification_type: string;
    channel: string;
    enabled: boolean;
    notify_contact: boolean;
    notify_assigned: boolean;
    notify_guests: boolean;
    additional_emails?: string[];
    additional_phones?: string[];
    subject?: string;
    body?: string;
    offset_minutes?: number;
  }> = await req.json();

  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'Expected array' }, { status: 400 });
  }

  const upserts = rows.map((r) => ({
    venue_id: venueId,
    notification_type: r.notification_type,
    channel: r.channel,
    enabled: r.enabled,
    notify_contact: r.notify_contact,
    notify_assigned: r.notify_assigned,
    notify_guests: r.notify_guests ?? false,
    additional_emails: r.additional_emails ?? [],
    additional_phones: r.additional_phones ?? [],
    subject: r.subject ?? null,
    body: r.body ?? null,
    offset_minutes: r.offset_minutes ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabaseAdmin
    .from('venue_calendar_notifications')
    .upsert(upserts, { onConflict: 'venue_id,notification_type,channel' })
    .select()
    .order('notification_type')
    .order('channel');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
