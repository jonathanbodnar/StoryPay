import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { getEffectiveVenueId } from '@/lib/effective-venue';
import { normalizePhone } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

async function getCookieVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function inviteEmailHtml({
  venueName, inviteeName, role, inviteUrl, brandColor = '#1b1b1b', logoUrl,
}: {
  venueName: string; inviteeName: string; role: string;
  inviteUrl: string; brandColor?: string; logoUrl?: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const roleLabel = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : 'Member';
  return buildSystemEmail({
    logoUrl:     logoUrl || undefined,
    brandName:   venueName,
    logoAlt:     venueName,
    accentColor: brandColor,
    title:       `You've been invited to join ${venueName}`,
    heading:     `You've been invited to join ${esc(venueName)}`,
    bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px;">Hi ${esc(inviteeName)},</p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">You&rsquo;ve been invited to join <strong>${esc(venueName)}</strong> on StoryVenue as a <strong>${roleLabel}</strong>. Click the button below to accept your invitation and access the account.</p>`,
    cta:              { label: 'Accept invitation', url: inviteUrl },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">This invitation was sent by ${esc(venueName)} via StoryVenue. If you didn&apos;t expect this, you can safely ignore it.</p>`,
  });
}

export async function GET(request: NextRequest) {
  const venueId = await getEffectiveVenueId(request);
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [membersRes, venueRes] = await Promise.all([
    supabaseAdmin
      .from('venue_team_members')
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('venues')
      .select('owner_id, email, owner_first_name, owner_last_name')
      .eq('id', venueId)
      .maybeSingle(),
  ]);

  if (membersRes.error) {
    if (membersRes.error.message?.includes('schema cache') || membersRes.error.message?.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  }

  const members: Record<string, unknown>[] = membersRes.data ?? [];

  // Prepend the venue owner so they appear in @mention autocomplete
  const venue = venueRes.data as Record<string, unknown> | null;
  if (venue?.owner_id) {
    const ownerEmail = (venue.email as string | null) ?? '';
    // Skip if the owner is already in venue_team_members (some setups add them)
    const alreadyInTeam = members.some(
      (m) => (m.email as string | null)?.toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (!alreadyInTeam && ownerEmail) {
      let firstName = (venue.owner_first_name as string | null) ?? '';
      let lastName  = (venue.owner_last_name  as string | null) ?? '';

      // Fallback: resolve name from profiles table
      if (!firstName) {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('full_name')
          .eq('id', venue.owner_id as string)
          .maybeSingle();
        if (prof?.full_name) {
          const parts = (prof.full_name as string).trim().split(/\s+/);
          firstName = parts[0] ?? '';
          lastName  = parts.slice(1).join(' ');
        }
      }

      members.unshift({
        id:         venue.owner_id,
        venue_id:   venueId,
        first_name: firstName,
        last_name:  lastName,
        email:      ownerEmail,
        role:       'owner',
      });
    }
  }

  return NextResponse.json(members);
}

export async function POST(request: NextRequest) {
  // POST (invite team member) intentionally stays venue-cookie scoped — only a
  // signed-in venue user should ever invite team. Super-admin/support can't
  // act-as-venue here.
  const venueId = await getCookieVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { first_name, last_name, email, role, phone } = body;

  if (!first_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'First name and email are required' }, { status: 400 });
  }

  // Required going forward so the concierge team can always reach a team
  // member by SMS (existing members added before this requirement keep
  // whatever they have on file — see PATCH /api/team/[id] for updates).
  const normalizedPhone = normalizePhone(phone);
  if (!phone?.trim() || !normalizedPhone) {
    return NextResponse.json({ error: 'A valid mobile phone number is required' }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('venue_team_members')
    .select('id')
    .eq('venue_id', venueId)
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A member with this email already exists.' }, { status: 409 });
  }

  // Fetch venue for email branding
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_color, brand_logo_url')
    .eq('id', venueId)
    .single();

  const { data: member, error } = await supabaseAdmin
    .from('venue_team_members')
    .insert({
      venue_id:   venueId,
      first_name: first_name.trim(),
      last_name:  (last_name || '').trim(),
      name:       [first_name.trim(), (last_name || '').trim()].filter(Boolean).join(' '),
      email:      email.trim().toLowerCase(),
      phone:      normalizedPhone,
      role:       role || 'member',
      status:     'invited',
      invited_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send invite email
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const inviteUrl = `${appUrl}/api/invite/${member.invite_token}`;
  const venueName = venue?.name || 'Your Venue';
  const inviteeName = first_name.trim();

  const emailResult = await sendEmail({
    to: member.email,
    subject: `You've been invited to join ${venueName} on StoryVenue`,
    html: inviteEmailHtml({
      venueName, inviteeName, role: member.role, inviteUrl,
      brandColor: venue?.brand_color || '#1b1b1b',
      logoUrl:    venue?.brand_logo_url || undefined,
    }),
  });

  if (!emailResult.success) {
    console.error('[team-invite] email failed:', emailResult.error);
    // Still return success — the member was created; invite can be resent
  }

  return NextResponse.json({ ...member, invite_url: inviteUrl }, { status: 201 });
}
