import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SignupPayload {
  venue_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request: NextRequest) {
  let payload: SignupPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueName = (payload.venue_name ?? '').trim();
  const firstName = (payload.first_name ?? '').trim();
  const lastName  = (payload.last_name ?? '').trim();
  const email     = (payload.email ?? '').trim().toLowerCase();
  const phone     = (payload.phone ?? '').trim();

  if (!venueName) return NextResponse.json({ error: 'Venue name is required.' }, { status: 400 });
  if (!firstName) return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
  if (!lastName)  return NextResponse.json({ error: 'Last name is required.' },  { status: 400 });
  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const fullName = `${firstName} ${lastName}`.trim();

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('venues')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (existingErr && existingErr.code !== 'PGRST116') {
    console.error('[signup] existence check failed:', existingErr);
    return NextResponse.json(
      { error: `Could not verify email: ${existingErr.message}` },
      { status: 500 }
    );
  }
  if (existing) {
    return NextResponse.json(
      { error: 'An account with that email already exists. Try signing in instead.' },
      { status: 409 }
    );
  }

  const { data: authCreate, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name:  fullName,
      first_name: firstName,
      last_name:  lastName,
      source:     'signup',
    },
  });

  if (authErr || !authCreate?.user) {
    console.error('[signup] auth.admin.createUser failed:', authErr);
    return NextResponse.json(
      { error: `Could not create user: ${authErr?.message ?? 'unknown error'}` },
      { status: 500 }
    );
  }
  const userId = authCreate.user.id;

  const rollback = async (reason: string) => {
    console.error('[signup] rolling back user', userId, 'because:', reason);
    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch (e) {
      console.error('[signup] rollback deleteUser failed:', e);
    }
  };

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingProfile) {
    const { error: profErr } = await supabaseAdmin.from('profiles').insert({
      id:        userId,
      full_name: fullName,
      role:      'venue_owner',
    });
    if (profErr) {
      console.error('[signup] profile insert failed:', profErr);
      await rollback(`profile insert: ${profErr.message}`);
      return NextResponse.json(
        { error: `Could not create profile: ${profErr.message}` },
        { status: 500 }
      );
    }
  }

  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .insert({
      owner_id: userId,
      name:     venueName,
      email,
      phone:    phone || null,
    })
    .select('id, login_token')
    .single();

  if (venueErr || !venue) {
    console.error('[signup] venue insert failed:', venueErr);
    await rollback(`venue insert: ${venueErr?.message ?? 'unknown'}`);
    return NextResponse.json(
      { error: `Could not create venue: ${venueErr?.message ?? 'unknown error'}` },
      { status: 500 }
    );
  }

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  const loginUrl = `${appUrl}/login/${venue.login_token}`;

  let emailSent = false;
  try {
    const emailResult = await sendEmail({
      to: email,
      subject: `Welcome to StoryPay — log in to finish setting up ${venueName}`,
      html: welcomeEmailHtml({ firstName, venueName, loginUrl }),
    });
    emailSent = emailResult.success !== false;
    if (!emailSent) {
      console.warn('[signup] email not sent:', emailResult.error);
    }
  } catch (e) {
    console.error('[signup] email send threw:', e);
  }

  return NextResponse.json({
    ok:         true,
    venue_id:   venue.id,
    email,
    email_sent: emailSent,
    login_url:  emailSent ? undefined : loginUrl,
  });
}

function welcomeEmailHtml({
  firstName,
  venueName,
  loginUrl,
}: {
  firstName: string;
  venueName: string;
  loginUrl: string;
}): string {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryPay</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Welcome, ${escapeHtml(firstName)}!</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
      Your StoryPay account for <strong>${escapeHtml(venueName)}</strong> is ready.
      Click the button below to log in and start setting up your directory listing.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${loginUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Log In &amp; Get Started</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${loginUrl}" style="color:#1b1b1b;text-decoration:underline;">${loginUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t sign up for StoryPay, you can safely ignore this email.
    </p>
  </div>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
