/**
 * GET /api/admin/support/private-clients
 *
 * Lists every venue the team has flagged as a white-glove "Private Client"
 * (venues.is_private_client = true — toggled from the Venue Management
 * card), together with the account's primary owner and active team members,
 * so the concierge team can see their whole watch list — and reach any
 * contact on it, by email or SMS — without leaving the Support Inbox.
 *
 * Auth: super admin OR support agent (same gate as the rest of /admin/support).
 */

import { NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { capitalizeName } from '@/lib/format-name';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VenueRow {
  id: string;
  name: string | null;
  slug: string | null;
  email: string | null;
  notification_email: string | null;
  notification_phone: string | null;
  phone: string | null;
  ghl_connected: boolean | null;
  owner_id: string | null;
  directory_plan_id: string | null;
  directory_subscription_status: string | null;
  venue_concierge: boolean | null;
}

interface TeamMemberRow {
  id: string;
  venue_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
}

export async function GET() {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venuesRaw, error } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, slug, email, notification_email, notification_phone, phone, ghl_connected, owner_id, directory_plan_id, directory_subscription_status, venue_concierge',
    )
    .eq('is_private_client', true)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venues = (venuesRaw ?? []) as VenueRow[];
  if (venues.length === 0) return NextResponse.json({ venues: [] });

  const venueIds = venues.map((v) => v.id);
  const ownerIds = Array.from(new Set(venues.map((v) => v.owner_id).filter((x): x is string => Boolean(x))));
  const planIds = Array.from(new Set(venues.map((v) => v.directory_plan_id).filter((x): x is string => Boolean(x))));

  const [{ data: teamRows }, { data: planRows }, { data: profileRows }, { data: recentMsgRows }] = await Promise.all([
    supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, name, first_name, last_name, email, phone, role, status')
      .in('venue_id', venueIds)
      .neq('status', 'inactive'),
    planIds.length > 0
      ? supabaseAdmin.from('directory_plans').select('id, name').in('id', planIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ownerIds.length > 0
      ? supabaseAdmin.from('profiles').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    // Most recent message per venue (across recipients) — used below to
    // flag venues whose latest activity is an unanswered inbound SMS reply
    // (see src/lib/concierge-sms-sync.ts). Fetched newest-first and reduced
    // to "first row seen per venue" in JS since Supabase-JS has no
    // DISTINCT ON; private_client_messages is low-volume so this is cheap.
    supabaseAdmin
      .from('private_client_messages')
      .select('venue_id, direction, created_at')
      .in('venue_id', venueIds)
      .order('created_at', { ascending: false })
      .limit(Math.min(1000, venueIds.length * 20)),
  ]);

  const needsReplyByVenue = new Map<string, boolean>();
  for (const m of (recentMsgRows ?? []) as Array<{ venue_id: string; direction: string | null }>) {
    if (needsReplyByVenue.has(m.venue_id)) continue;
    needsReplyByVenue.set(m.venue_id, m.direction === 'inbound');
  }

  const teamByVenue = new Map<string, TeamMemberRow[]>();
  for (const t of (teamRows ?? []) as TeamMemberRow[]) {
    const list = teamByVenue.get(t.venue_id) ?? [];
    list.push(t);
    teamByVenue.set(t.venue_id, list);
  }
  const planNameById = new Map<string, string>(
    ((planRows ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const profileNameById = new Map<string, string>(
    ((profileRows ?? []) as Array<{ id: string; full_name: string | null }>)
      .filter((p) => p.full_name)
      .map((p) => [p.id, p.full_name as string]),
  );

  // Owner auth emails require one admin lookup per unique owner — small list
  // (private clients are a hand-picked subset), so sequential is fine and
  // avoids hammering the auth API with a burst of parallel calls.
  const ownerEmailById = new Map<string, string | null>();
  for (const ownerId of ownerIds) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(ownerId);
      ownerEmailById.set(ownerId, data?.user?.email?.trim() || null);
    } catch {
      ownerEmailById.set(ownerId, null);
    }
  }

  const result = venues.map((v) => {
    const ownerEmail =
      (v.owner_id ? ownerEmailById.get(v.owner_id) : null) || v.notification_email || v.email || null;
    const ownerName = capitalizeName((v.owner_id ? profileNameById.get(v.owner_id) : null) || null) || null;
    const team = (teamByVenue.get(v.id) ?? []).map((t) => ({
      id: t.id,
      name: capitalizeName(t.name || [t.first_name, t.last_name].filter(Boolean).join(' ').trim()) || t.email || 'Team member',
      email: t.email,
      phone: t.phone || null,
      // SMS rides the venue's own GHL/A2P connection — same requirement as
      // the owner, just keyed off this member's own phone on file.
      smsAvailable: Boolean(v.ghl_connected && t.phone),
      role: t.role,
      status: t.status,
    }));

    return {
      id: v.id,
      name: v.name || 'Unnamed venue',
      slug: v.slug,
      planName: v.directory_plan_id ? planNameById.get(v.directory_plan_id) ?? null : null,
      subscriptionStatus: v.directory_subscription_status,
      ghlConnected: Boolean(v.ghl_connected),
      venueConcierge: Boolean(v.venue_concierge),
      needsReply: needsReplyByVenue.get(v.id) === true,
      owner: {
        name: ownerName,
        email: ownerEmail,
        phone: v.notification_phone || v.phone || null,
        // SMS rides the venue's own GHL/A2P connection — owner's number
        // comes from venues.notification_phone/phone.
        smsAvailable: Boolean(v.ghl_connected && (v.notification_phone || v.phone)),
      },
      teamMembers: team,
    };
  });

  return NextResponse.json({ venues: result });
}
