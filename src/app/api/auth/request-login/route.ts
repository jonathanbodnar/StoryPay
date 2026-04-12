import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email?.trim() || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

  // Check venue owner accounts
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, login_token, email')
    .eq('email', normalized)
    .single();

  // Check team member accounts (table may not exist in production — handle gracefully)
  let member: { id: string; invite_token: string; first_name: string; venue_id: string } | null = null;
  try {
    const memberRes = await supabaseAdmin
      .from('venue_team_members')
      .select('id, invite_token, first_name, venue_id')
      .eq('email', normalized)
      .eq('status', 'active')
      .maybeSingle();
    member = memberRes.data ?? null;
  } catch { /* table may not exist in production */ }

  if (!venue && !member) {
    // Always return success — don't reveal whether the email exists or not (security)
    return NextResponse.json({ ok: true });
  }

  if (venue?.login_token) {
    const loginUrl = `${appUrl}/login/${venue.login_token}`;
    await sendEmail({
      to: normalized,
      subject: `Your StoryPay login link for ${venue.name || 'your account'}`,
      html: loginEmailHtml({ name: venue.name || 'your account', loginUrl, appUrl, isTeamMember: false }),
    });
  }

  if (member?.invite_token) {
    // Re-use the invite token as the login link for active team members
    const loginUrl = `${appUrl}/api/invite/${member.invite_token}`;
    const { data: venueData } = await supabaseAdmin
      .from('venues')
      .select('name, brand_color, brand_logo_url')
      .eq('id', member.venue_id)
      .single();

    await sendEmail({
      to: normalized,
      subject: `Your StoryPay login link`,
      html: loginEmailHtml({
        name: member.first_name || 'there',
        loginUrl,
        appUrl,
        isTeamMember: true,
        venueName: venueData?.name,
        brandColor: venueData?.brand_color,
        logoUrl: venueData?.brand_logo_url,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}

function loginEmailHtml({
  name, loginUrl, appUrl, isTeamMember = false,
  venueName, brandColor = '#1b1b1b', logoUrl,
}: {
  name: string; loginUrl: string; appUrl: string; isTeamMember?: boolean;
  venueName?: string; brandColor?: string; logoUrl?: string;
}) {
  const headerHtml = logoUrl
    ? `<div style="background-color:#ffffff;padding:24px 32px 20px;border-radius:12px 12px 0 0;border:1px solid #e5e7eb;border-bottom:4px solid ${brandColor}">
        <img src="${logoUrl}" alt="${venueName || 'StoryPay'}" style="max-height:48px;max-width:180px;width:auto;height:auto;display:block;">
       </div>`
    : `<div style="background-color:${brandColor};padding:28px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${isTeamMember && venueName ? venueName : 'StoryPay'}</h1>
       </div>`;

  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  ${headerHtml}
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Your login link</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">Hi ${name},</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Click the button below to log in to your StoryPay account${isTeamMember && venueName ? ` (${venueName})` : ''}. This link is valid for your current session.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${loginUrl}"
        style="background-color:${brandColor};border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:220px;">
        <span style="color:#ffffff;text-decoration:none;">Log In to StoryPay</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${loginUrl}" style="color:${brandColor};text-decoration:underline;">${loginUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t request this link, you can safely ignore this email. Your account is still secure.
    </p>
  </div>
</div>`;
}
