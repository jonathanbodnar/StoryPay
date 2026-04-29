/**
 * POST /api/venues/me/delete
 *
 * Permanently deletes the authenticated venue and all associated data.
 * Only the venue owner (role === 'owner') can call this.
 * Requires a confirmation body: { confirmName: string } matching the venue name.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const memberId = c.get('member_id')?.value;

  if (!venueId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Only the venue owner may delete the account
  if (memberId) {
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('role')
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!member || member.role !== 'owner') {
      return NextResponse.json({ error: 'Only the venue owner can delete this account' }, { status: 403 });
    }
  }

  // Parse confirmation
  let body: { confirmName?: string };
  try { body = await request.json(); } catch { body = {}; }

  // Fetch venue to validate confirm name and grab owner_id for auth cleanup
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_id')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  if (!body.confirmName || body.confirmName.trim() !== venue.name.trim()) {
    return NextResponse.json({ error: 'Confirmation name does not match' }, { status: 400 });
  }

  // Best-effort storage cleanup
  try {
    const buckets = [
      { bucket: 'venue-images', prefix: `${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-logos/${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-covers/${venueId}/` },
    ];
    for (const { bucket, prefix } of buckets) {
      const { data: files } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f: { name: string }) => `${prefix}${f.name}`);
        await supabaseAdmin.storage.from(bucket).remove(paths);
      }
    }
  } catch { /* non-fatal */ }

  // Delete venue row — cascade handles all related rows
  const { error } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Delete the Supabase Auth user so the email can be reused for a new account
  const ownerId = (venue as { owner_id?: string | null }).owner_id;
  if (ownerId) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(ownerId);
    } catch (e) {
      console.warn('[venues/me/delete] auth user deletion failed (non-fatal):', e);
    }
  }

  // Clear session cookies
  const response = NextResponse.json({ deleted: true });
  response.cookies.delete('venue_id');
  response.cookies.delete('member_id');
  return response;
}
