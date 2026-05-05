/**
 * GET /api/admin/support/tickets/[id]
 *
 * Returns a single support ticket — venue + opener context, full message
 * history, and the names of any support agents who replied.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ThreadRow {
  id:                       string;
  venue_id:                 string;
  opened_by_profile_id:     string | null;
  opened_by_member_id:      string | null;
  subject:                  string;
  status:                   'open' | 'pending' | 'closed';
  priority:                 'low' | 'normal' | 'high';
  assigned_support_user_id: string | null;
  last_message_at:          string;
  last_message_preview:     string | null;
  created_at:               string;
  updated_at:               string;
}

interface MessageRow {
  id:                     string;
  support_thread_id:      string;
  sender_type:            'venue' | 'support';
  sender_profile_id:      string | null;
  sender_member_id:       string | null;
  sender_support_user_id: string | null;
  body:                   string;
  attachments:            unknown;
  created_at:             string;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  const { data: tRow, error: tErr } = await supabaseAdmin
    .from('support_threads')
    .select(`
      id, venue_id, opened_by_profile_id, opened_by_member_id,
      subject, status, priority, assigned_support_user_id,
      last_message_at, last_message_preview,
      created_at, updated_at
    `)
    .eq('id', id)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  const ticket = tRow as ThreadRow | null;
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const [{ data: venueRow }, { data: msgs }, { data: profileRow }, { data: memberRow }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, notification_email, contact_email, phone, timezone')
      .eq('id', ticket.venue_id)
      .maybeSingle(),
    supabaseAdmin
      .from('support_thread_messages')
      .select('id, support_thread_id, sender_type, sender_profile_id, sender_member_id, sender_support_user_id, body, attachments, created_at')
      .eq('support_thread_id', id)
      .order('created_at', { ascending: true }),
    ticket.opened_by_profile_id
      ? supabaseAdmin
          .from('profiles')
          .select('id, full_name')
          .eq('id', ticket.opened_by_profile_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ticket.opened_by_member_id
      ? supabaseAdmin
          .from('venue_team_members')
          .select('id, first_name, last_name, email')
          .eq('id', ticket.opened_by_member_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const messages = (msgs as MessageRow[]) || [];

  // Resolve sender labels
  const profileIds = Array.from(new Set(messages.map(m => m.sender_profile_id).filter((x): x is string => Boolean(x))));
  const memberIds  = Array.from(new Set(messages.map(m => m.sender_member_id).filter((x): x is string => Boolean(x))));
  const supportIds = Array.from(new Set(messages.map(m => m.sender_support_user_id).filter((x): x is string => Boolean(x))));

  const [profiles, members, supportAgents] = await Promise.all([
    profileIds.length
      ? supabaseAdmin.from('profiles').select('id, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    memberIds.length
      ? supabaseAdmin.from('venue_team_members').select('id, first_name, last_name, email').in('id', memberIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] }),
    supportIds.length
      ? supabaseAdmin.from('support_team_members').select('id, name, email').in('id', supportIds)
      : Promise.resolve({ data: [] as { id: string; name: string; email: string }[] }),
  ]);

  const profileMap = Object.fromEntries((profiles.data || []).map(r => [r.id, r]));
  const memberMap  = Object.fromEntries((members.data || []).map(r => [r.id, r]));
  const supportMap = Object.fromEntries((supportAgents.data || []).map(r => [r.id, r]));

  const opener = (() => {
    if (profileRow) {
      const p = profileRow as { id: string; full_name: string | null };
      return { kind: 'owner' as const, label: p.full_name || 'Venue owner', email: null };
    }
    if (memberRow) {
      const m = memberRow as { id: string; first_name: string | null; last_name: string | null; email: string | null };
      const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
      return { kind: 'team_member' as const, label: name || m.email || 'Team member', email: m.email };
    }
    return { kind: 'unknown' as const, label: 'Venue user', email: null };
  })();

  return NextResponse.json({
    ticket,
    venue: venueRow,
    opener,
    messages,
    senders: {
      profiles: profileMap,
      members:  memberMap,
      support:  supportMap,
    },
  });
}
