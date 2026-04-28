import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface TeamContact {
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: 'owner' | 'admin' | 'member';
  sort_order: number;
}

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch venue owner + team members in parallel
  const [venueRes, profileRes, membersRes] = await Promise.all([
    supabaseAdmin.from('venues').select('email, phone, owner_first_name, owner_last_name, owner_id').eq('id', venueId).maybeSingle(),
    // profiles fallback for owner name
    supabaseAdmin.from('venues').select('owner_id').eq('id', venueId).maybeSingle(),
    supabaseAdmin.from('venue_team_members').select('first_name, last_name, email, role').eq('venue_id', venueId).order('created_at', { ascending: true }),
  ]);

  const venue = venueRes.data;
  const contacts: TeamContact[] = [];

  if (venue?.email) {
    let firstName = (venue as Record<string, unknown>).owner_first_name as string | null ?? '';
    let lastName  = (venue as Record<string, unknown>).owner_last_name  as string | null ?? '';

    // Fallback to profiles table for accounts before migration 070
    if (!firstName && (profileRes.data as Record<string,unknown> | null)?.owner_id) {
      const ownerId = (profileRes.data as Record<string,unknown>).owner_id as string;
      const { data: prof } = await supabaseAdmin.from('profiles').select('full_name').eq('id', ownerId).maybeSingle();
      if (prof?.full_name) {
        const parts = prof.full_name.trim().split(/\s+/);
        firstName = parts[0] ?? '';
        lastName  = parts.slice(1).join(' ');
      }
    }

    contacts.push({
      email:      venue.email.trim().toLowerCase(),
      first_name: firstName,
      last_name:  lastName,
      phone:      (venue.phone as string | null) ?? null,
      role:       'owner',
      sort_order: 0,
    });
  }

  for (const m of membersRes.data ?? []) {
    const email = (m.email as string | null)?.trim().toLowerCase() ?? '';
    if (!email) continue;
    if (contacts.some((c) => c.email === email)) continue;
    contacts.push({
      email,
      first_name: (m.first_name as string) ?? '',
      last_name:  (m.last_name  as string) ?? '',
      phone:      null,
      role:       (m.role as 'admin' | 'member') ?? 'member',
      sort_order: 1,
    });
  }

  return NextResponse.json(contacts);
}
