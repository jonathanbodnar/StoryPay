import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Look up the invite
  const { data: member, error } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, email, first_name, last_name, role, status')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !member) {
    redirect('/invite/invalid');
  }

  // Mark as accepted
  await supabaseAdmin
    .from('venue_team_members')
    .update({ status: 'active' })
    .eq('id', member.id);

  // Set the venue_id cookie so they're logged in to this venue
  const cookieStore = await cookies();
  cookieStore.set('venue_id', member.venue_id, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect('/dashboard');
}
