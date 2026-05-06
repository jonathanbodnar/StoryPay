/**
 * Calendar events for a contact, viewed/created from the super-admin support
 * inbox. Writes go to `calendar_events` — the exact same table the venue's
 * own calendar reads from — and the post-insert hook still pushes to the
 * venue's connected Google Calendar. So an event booked here shows up:
 *
 *   • on the venue's in-app calendar (it queries `calendar_events`)
 *   • on the venue owner's Google Calendar (push hook)
 *   • on the support agent's contact card (this endpoint's GET)
 *
 *   GET    list upcoming + recent events for this contact, plus the venue's
 *          calendars so the UI can render a calendar picker
 *   POST   { title, start_at, end_at, calendar_id?, notes? } → create
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';
import { pushEventCreateToGoogle } from '@/lib/google-calendar-push';
import { syncAppointmentRemindersForEvent } from '@/lib/appointment-reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ venueId: string; customerId: string }> };

async function ensureAuthorized(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true };
}

async function loadCustomer(venueId: string, customerId: string) {
  const { data } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, first_name, last_name, phone')
    .eq('id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return data as { id: string; customer_email: string | null; first_name: string | null; last_name: string | null; phone: string | null } | null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  const customer = await loadCustomer(venueId, customerId);
  if (!customer) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  // Calendars the venue owns — used by the booking UI to let the agent pick
  // which calendar the event lands on (e.g. "Tours", "Tastings", etc.).
  const { data: calendars } = await supabaseAdmin
    .from('venue_calendars')
    .select('id, name, color, is_default, sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });

  // Events for this contact: match on customer_email (canonical link in the
  // calendar_events table). Limit the window so we never return thousands of
  // historical events to the sidebar.
  let events: Array<Record<string, unknown>> = [];
  if (customer.customer_email) {
    const { data, error } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at, all_day, status, notes, calendar_id, google_html_link, customer_email')
      .eq('venue_id', venueId)
      .ilike('customer_email', customer.customer_email)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('[admin/support contact calendar GET]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    events = (data ?? []) as Array<Record<string, unknown>>;
  }

  return NextResponse.json({
    contact: {
      id:    customer.id,
      email: customer.customer_email,
      name:  [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
    },
    calendars: calendars ?? [],
    events,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  const customer = await loadCustomer(venueId, customerId);
  if (!customer) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (!customer.customer_email) {
    return NextResponse.json(
      { error: 'Contact is missing an email address; add one before booking an event.' },
      { status: 400 },
    );
  }

  let body: {
    title?: string;
    start_at?: string;
    end_at?: string;
    all_day?: boolean;
    calendar_id?: string | null;
    notes?: string | null;
    event_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = (body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!body.start_at || !body.end_at) {
    return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  }
  if (new Date(body.end_at) <= new Date(body.start_at)) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
  }

  const insertPayload: Record<string, unknown> = {
    venue_id:       venueId,
    customer_email: customer.customer_email,
    title,
    event_type:     body.event_type || 'other',
    status:         'confirmed',
    start_at:       body.start_at,
    end_at:         body.end_at,
    all_day:        body.all_day ?? false,
    notes:          body.notes ?? null,
    calendar_id:    body.calendar_id || null,
  };

  const { data: row, error } = await supabaseAdmin
    .from('calendar_events')
    .insert(insertPayload)
    .select('id, title, start_at, end_at, all_day, status, notes, calendar_id, customer_email')
    .single();

  if (error || !row) {
    console.error('[admin/support contact calendar POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to create event' }, { status: 500 });
  }

  // Schedule reminders + push to Google Calendar — fire-and-forget so the
  // agent UI returns immediately. Same pattern used by the venue-side
  // /api/calendar POST.
  void syncAppointmentRemindersForEvent(String((row as { id: string }).id));
  void (async () => {
    try {
      const { data: calSettings } = await supabaseAdmin
        .from('venue_calendar_settings')
        .select('timezone')
        .eq('venue_id', venueId)
        .maybeSingle();
      const tz = (calSettings as { timezone?: string } | null)?.timezone ?? null;
      const link = await pushEventCreateToGoogle(venueId, {
        title,
        start_at: body.start_at as string,
        end_at:   body.end_at as string,
        all_day:  !!body.all_day,
        notes:    body.notes ?? null,
        attendees: customer.customer_email ? [customer.customer_email] : [],
        time_zone: tz,
      });
      if (link) {
        await supabaseAdmin
          .from('calendar_events')
          .update({
            google_event_id:    link.google_event_id,
            google_calendar_id: link.google_calendar_id,
            google_html_link:   link.html_link ?? null,
          })
          .eq('id', String((row as { id: string }).id));
      }
    } catch (e) {
      console.error('[admin/support contact calendar POST] post-insert side-effects', e);
    }
  })();

  return NextResponse.json({ event: row }, { status: 201 });
}
