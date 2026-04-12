import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function inviteEmailHtml({
  venueName, inviteeName, role, inviteUrl, brandColor = '#1b1b1b', logoUrl,
}: { venueName: string; inviteeName: string; role: string; inviteUrl: string; brandColor?: string; logoUrl?: string; }) {
  const roleLabel = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : 'Member';
  const headerHtml = logoUrl
    ? `<div style="background-color:#ffffff;padding:24px 32px 20px;border-radius:12px 12px 0 0;border:1px solid #e5e7eb;border-bottom:4px solid ${brandColor}">
        <img src="${logoUrl}" alt="${venueName}" style="max-height:56px;max-width:200px;width:auto;height:auto;display:block;background-color:#ffffff">
       </div>`
    : `<div style="background-color:${brandColor};padding:28px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${venueName}</h1>
       </div>`;
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  ${headerHtml}
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">You&rsquo;ve been invited to join ${venueName}</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">Hi ${inviteeName},</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      You&rsquo;ve been invited to join <strong>${venueName}</strong> on StoryPay as a <strong>${roleLabel}</strong>.
      Click the button below to accept your invitation and access the account.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${inviteUrl}" style="background-color:${brandColor};border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Accept Invitation</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${inviteUrl}" style="color:${brandColor};text-decoration:underline;">${inviteUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      Sent by ${venueName} via StoryPay. If you didn&apos;t expect this, you can safely ignore it.
    </p>
  </div>
</div>`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: member, error } = await supabaseAdmin
    .from('venue_team_members')
    .update({ invited_at: new Date().toISOString() })
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const inviteUrl = `${appUrl}/api/invite/${member.invite_token}`;

  await sendEmail({
    to: member.email,
    subject: `You've been invited to join ${venue?.name || 'Your Venue'} on StoryPay`,
    html: inviteEmailHtml({
      venueName:   venue?.name || 'Your Venue',
      inviteeName: member.first_name || member.name || 'there',
      role:        member.role,
      inviteUrl,
      brandColor:  venue?.brand_color || '#1b1b1b',
      logoUrl:     venue?.brand_logo_url || undefined,
    }),
  });

  return NextResponse.json(member);
}
