import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — list support team members. (Members are added under Team, through
 * /api/admin/team-members, which invites them.)
 * Visible to either the master super admin or any logged-in support agent
 * (the inbox UI uses it to populate the identity picker / show coworkers).
 */
export async function GET() {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from('support_team_members')
    .select('id, email, name, role, active, last_login_at, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}
