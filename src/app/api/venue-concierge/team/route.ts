/**
 * GET /api/venue-concierge/team
 *
 * Active concierge team members (name, role, photo) for the "meet your
 * concierge team" header on the Venue Concierge page. Excludes the synthetic
 * super-admin sentinel row.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLE_LABELS: Record<string, string> = {
  support_admin: 'Concierge Lead',
  support_agent: 'Concierge',
};

// Only the concierges actually assigned to venues are shown on the venue-facing
// header, so owners don't infer the size of the whole company. Matched on first
// name (case-insensitive).
const VENUE_FACING_FIRST_NAMES = new Set(['francine', 'michaela']);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabaseAdmin
    .from('support_team_members')
    .select('id, name, first_name, last_name, avatar_url, role, active')
    .eq('active', true)
    .neq('id', SUPER_ADMIN_SUPPORT_USER_ID)
    .order('created_at', { ascending: true });

  const firstNameOf = (p: { first_name: string | null; name: string | null }): string =>
    (p.first_name || (p.name || '').split(/\s+/)[0] || '').trim().toLowerCase();

  const team = ((rows ?? []) as Array<{
    id: string; name: string | null; first_name: string | null; last_name: string | null;
    avatar_url: string | null; role: string | null;
  }>)
    .filter((p) => VENUE_FACING_FIRST_NAMES.has(firstNameOf(p)))
    .map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || 'StoryVenue Concierge',
      roleLabel: (p.role && ROLE_LABELS[p.role]) || 'Concierge',
      avatarUrl: p.avatar_url,
    }));

  return NextResponse.json({ team });
}
