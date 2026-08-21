import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import crypto from 'node:crypto';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function inviteEmailHtml({
  venueName, inviteeName, role, inviteUrl, brandColor = '#1b1b1b', logoUrl,
}: { venueName: string; inviteeName: string; role: string; inviteUrl: string; brandColor?: string; logoUrl?: string; }) {
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
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">Sent by ${esc(venueName)} via StoryVenue. If you didn&apos;t expect this, you can safely ignore it.</p>`,
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Rotate the invite_token on every resend so the new email always carries a
  // fresh link, and any previously-sent link is invalidated.
  const freshToken = crypto.randomUUID();

  const { data: member, error } = await supabaseAdmin
    .from('venue_team_members')
    .update({ invited_at: new Date().toISOString(), invite_token: freshToken })
    .eq('id', id)
    .eq('venue_id', venueId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!member) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_color, brand_logo_url')
    .eq('id', venueId)
    .single();

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const inviteUrl = `${appUrl}/api/invite/${member.invite_token}`;

  const emailResult = await sendEmail({
    to: member.email,
    subject: `You've been invited to join ${venue?.name || 'Your Venue'} on StoryVenue`,
    html: inviteEmailHtml({
      venueName:   venue?.name || 'Your Venue',
      inviteeName: member.first_name || member.name || 'there',
      role:        member.role,
      inviteUrl,
      brandColor:  venue?.brand_color || '#1b1b1b',
      logoUrl:     venue?.brand_logo_url || undefined,
    }),
  });

  if (!emailResult.success) {
    console.error('[team-resend-invite] email failed for', member.email, ':', emailResult.error);
    return NextResponse.json(
      { error: `Invite email failed to send: ${emailResult.error ?? 'unknown error'}`, emailError: emailResult.error },
      { status: 500 },
    );
  }

  console.log('[team-resend-invite] invite resent to', member.email);
  return NextResponse.json({ ...member, emailSent: true });
}
