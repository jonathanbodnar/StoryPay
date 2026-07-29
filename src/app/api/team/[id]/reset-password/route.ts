import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function passwordResetEmailHtml({
  venueName, memberName, resetUrl, brandColor = '#1b1b1b', logoUrl,
}: {
  venueName: string;
  memberName: string;
  resetUrl: string;
  brandColor?: string;
  logoUrl?: string;
}): string {
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
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Set your password</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">Hi ${memberName},</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Your account manager at <strong>${venueName}</strong> has requested a password reset for your
      StoryVenue account. Click the button below to set a new password.
      This link expires in <strong>24 hours</strong>.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${resetUrl}"
        style="background-color:${brandColor};border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Set Password</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${resetUrl}" style="color:${brandColor};text-decoration:underline;">${resetUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t expect this, you can safely ignore it. Your password will not change unless you follow the link above.
    </p>
  </div>
</div>`;
}

/**
 * POST /api/team/[id]/reset-password
 *
 * Venue-owner action: regenerates the team member's invite_token and sends
 * them a "Set your password" email. The link expires in 24 hours.
 *
 * Works for both active and invited members.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Generate a fresh invite_token — this invalidates any previous reset link.
  const newToken = crypto.randomUUID();

  const { data: member, error } = await supabaseAdmin
    .from('venue_team_members')
    .update({ invite_token: newToken })
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, email, first_name, name, role, status')
    .single();

  if (error || !member) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_color, brand_logo_url')
    .eq('id', venueId)
    .single();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const resetUrl = `${appUrl}/reset-password/member?token=${newToken}`;
  const venueName = venue?.name ?? 'Your Venue';
  const memberName = (member.first_name as string | null) || (member.name as string | null) || 'there';

  const emailResult = await sendEmail({
    to: member.email as string,
    subject: `Set your password for ${venueName} on StoryVenue`,
    html: passwordResetEmailHtml({
      venueName,
      memberName,
      resetUrl,
      brandColor: (venue?.brand_color as string | null) ?? '#1b1b1b',
      logoUrl: (venue?.brand_logo_url as string | null) ?? undefined,
    }),
  });

  if (!emailResult.success) {
    console.error('[team/reset-password] email failed:', emailResult.error);
  }

  return NextResponse.json({ ok: true });
}
