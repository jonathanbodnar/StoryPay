import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/calendar/ai-search
 *
 * Body: { query: string }
 *
 * Loads the venue's upcoming events (next 90 days + past 30 days) and either:
 * - Returns keyword-matched events (if query is short/simple)
 * - Calls OpenAI to answer natural-language questions about the calendar
 *
 * Always returns: { answer: string | null, events: CalEventResult[] }
 */

interface CalEventResult {
  id: string;
  title: string;
  event_type: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_email: string | null;
  notes: string | null;
  calendar_name: string | null;
  calendar_color: string | null;
  space_name: string | null;
}

function formatDateForAI(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function buildEventsContext(events: CalEventResult[], tz: string): string {
  if (events.length === 0) return 'No events found.';

  return events.slice(0, 80).map((e) => {
    const lines = [
      `- "${e.title}" (${e.event_type}, ${e.status})`,
      `  Date: ${formatDateForAI(e.start_at, tz)}`,
    ];
    if (e.customer_email) lines.push(`  Contact: ${e.customer_email}`);
    if (e.calendar_name)  lines.push(`  Calendar: ${e.calendar_name}`);
    if (e.space_name)     lines.push(`  Space: ${e.space_name}`);
    if (e.notes)          lines.push(`  Notes: ${e.notes.slice(0, 120)}`);
    return lines.join('\n');
  }).join('\n\n');
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { query?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const query = body.query?.trim() ?? '';
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });

  // ── Load events (past 30 days + next 90 days) ─────────────────────────────
  const now     = new Date();
  const past    = new Date(now.getTime() - 30  * 24 * 60 * 60 * 1000).toISOString();
  const future  = new Date(now.getTime() + 90  * 24 * 60 * 60 * 1000).toISOString();

  const { data: rawEvents } = await supabaseAdmin
    .from('calendar_events')
    .select(`
      id, title, event_type, status, start_at, end_at, customer_email, notes, calendar_id,
      venue_spaces:space_id ( name ),
      venue_calendars:calendar_id ( name, color )
    `)
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_at', past)
    .lte('start_at', future)
    .order('start_at', { ascending: true })
    .limit(200);

  const events: CalEventResult[] = (rawEvents ?? []).map((e) => {
    const vs = e.venue_spaces as { name?: string } | null;
    const vc = (Array.isArray(e.venue_calendars) ? e.venue_calendars[0] : e.venue_calendars) as { name?: string; color?: string } | null;
    return {
      id:             e.id,
      title:          e.title,
      event_type:     e.event_type,
      status:         e.status,
      start_at:       e.start_at,
      end_at:         e.end_at,
      customer_email: e.customer_email ?? null,
      notes:          e.notes ?? null,
      calendar_name:  vc?.name ?? null,
      calendar_color: vc?.color ?? null,
      space_name:     vs?.name ?? null,
    };
  });

  // ── Always run keyword search for the events panel ────────────────────────
  const q = query.toLowerCase();
  const matched = events.filter((e) =>
    e.title.toLowerCase().includes(q) ||
    (e.customer_email ?? '').toLowerCase().includes(q) ||
    (e.calendar_name ?? '').toLowerCase().includes(q) ||
    (e.space_name ?? '').toLowerCase().includes(q) ||
    (e.notes ?? '').toLowerCase().includes(q) ||
    e.event_type.toLowerCase().includes(q) ||
    e.status.toLowerCase().includes(q),
  ).slice(0, 20);

  // ── Fetch venue timezone ──────────────────────────────────────────────────
  const { data: calSettings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('timezone')
    .eq('venue_id', venueId)
    .maybeSingle();
  const tz = (calSettings as { timezone?: string } | null)?.timezone ?? 'America/New_York';

  // ── AI answer via OpenAI ──────────────────────────────────────────────────
  let answer: string | null = null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const todayStr = new Date().toLocaleDateString('en-US', {
        timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      const eventsContext = buildEventsContext(events, tz);

      const systemPrompt = `You are a smart calendar assistant for a wedding venue.
Today is ${todayStr} (${tz}).
You have access to the venue's upcoming calendar events listed below.
Answer questions concisely and helpfully. When listing events, include their date and contact name.
If you don't know the answer based on the events, say so briefly.
Always be accurate — only state facts visible in the event data.

CALENDAR EVENTS (next 90 days + past 30 days):
${eventsContext}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      answer = response.choices[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      console.error('[calendar/ai-search] OpenAI error:', err);
      // Fall through — return keyword results without AI answer
    }
  }

  return NextResponse.json({ answer, events: matched, totalEvents: events.length });
}
