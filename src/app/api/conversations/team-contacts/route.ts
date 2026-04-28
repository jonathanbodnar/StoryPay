import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface TeamContact {
  email: string;
  first_name: string;
  last_name: string;
  role: 'owner' | 'admin' | 'member';
  /** "owner" contacts sort before "admin"/"member" contacts */
  sort_order: number;
}

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Venue owner (from venues table)
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('email, owner_first_name, owner_last_name, name')
    .eq('id', venueId)
    .maybeSingle();

  // Team members
  const { data: members } = await supabaseAdmin
    .from('venue_team_members')
    .select('first_name, last_name, email, role')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  const contacts: TeamContact[] = [];

  if (venue?.email) {
    contacts.push({
      email:      venue.email.trim().toLowerCase(),
      first_name: (venue as Record<string, unknown>).owner_first_name as string ?? '',
      last_name:  (venue as Record<string, unknown>).owner_last_name  as string ?? '',
      role:       'owner',
      sort_order: 0,
    });
  }

  for (const m of members ?? []) {
    const email = (m.email as string | null)?.trim().toLowerCase() ?? '';
    if (!email) continue;
    // Skip if already in list (owner email matches a team member email)
    if (contacts.some((c) => c.email === email)) continue;
    contacts.push({
      email,
      first_name: (m.first_name as string) ?? '',
      last_name:  (m.last_name  as string) ?? '',
      role:       (m.role as 'admin' | 'member') ?? 'member',
      sort_order: 1,
    });
  }

  return NextResponse.json(contacts);
}
