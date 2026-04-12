import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function inviteEmailHtml({
  venueName,
  inviteeName,
  role,
  inviteUrl,
}: {
  venueName: string;
  inviteeName: string;
  role: string;
  inviteUrl: string;
}): string {
  const roleLabel = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : 'Member';
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${venueName}</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">You&rsquo;ve been invited to join ${venueName}</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px">Hi ${inviteeName},</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      You&rsquo;ve been invited to join <strong>${venueName}</strong> on StoryPay as a <strong>${roleLabel}</strong>.
      Click the button below to accept your invitation and access the account.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${inviteUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Accept Invitation</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${inviteUrl}" style="color:#1b1b1b;text-decoration:underline;">${inviteUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      This invitation was sent by ${venueName} via StoryPay. If you didn&apos;t expect this, you can safely ignore it.
    </p>
  </div>
</div>`;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { first_name, last_name, email, role } = body;

  if (!first_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'First name and email are required' }, { status: 400 });
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

  // Fetch venue name for the email
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name')
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
      role:       role || 'member',
      status:     'invited',
      invited_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send invite email
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const inviteUrl = `${appUrl}/api/invite/${member.invite_token}`;
  const venueName = venue?.name || 'Your Venue';
  const inviteeName = first_name.trim();

  const emailResult = await sendEmail({
    to: member.email,
    subject: `You've been invited to join ${venueName} on StoryPay`,
    html: inviteEmailHtml({ venueName, inviteeName, role: member.role, inviteUrl }),
  });

  if (!emailResult.success) {
    console.error('[team-invite] email failed:', emailResult.error);
    // Still return success — the member was created; invite can be resent
  }

  return NextResponse.json({ ...member, invite_url: inviteUrl }, { status: 201 });
}
