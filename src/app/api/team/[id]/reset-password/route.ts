import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
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
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return buildSystemEmail({
    logoUrl:     logoUrl || undefined,
    brandName:   venueName,
    logoAlt:     venueName,
    accentColor: brandColor,
    title:       'Set your password',
    heading:     'Set your password',
    bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px;">Hi ${esc(memberName)},</p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">Your account manager at <strong>${esc(venueName)}</strong> has requested a password reset for your StoryVenue account. Click the button below to set a new password. This link expires in <strong>24 hours</strong>.</p>`,
    cta:              { label: 'Set password', url: resetUrl },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">If you didn&apos;t expect this, you can safely ignore it. Your password will not change unless you follow the link above.</p>`,
  });
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
