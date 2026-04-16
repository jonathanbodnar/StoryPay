import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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

  const sql = getDb();

  const existing = await sql`
    SELECT id FROM public.venues WHERE lower(email) = ${email} LIMIT 1
  `;
  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'An account with that email already exists. Try signing in instead.' },
      { status: 409 }
    );
  }

  const fullName = `${firstName} ${lastName}`.trim();

  let venueId: string;
  let loginToken: string;
  try {
    const result = await sql.begin(async (tx) => {
      const [user] = await tx`
        INSERT INTO auth.users (
          id, aud, role, email, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at,
          is_sso_user, is_anonymous
        ) VALUES (
          gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(),
          ${sql.json({ provider: 'storypay', providers: ['storypay'] })}::jsonb,
          ${sql.json({ source: 'signup', full_name: fullName })}::jsonb,
          now(), now(),
          false, false
        )
        RETURNING id
      `;
      const userId = user.id as string;

      await tx`
        INSERT INTO public.profiles (id, full_name, role)
        VALUES (${userId}, ${fullName}, 'venue_owner')
      `;

      const [venue] = await tx`
        INSERT INTO public.venues (owner_id, name, email, phone)
        VALUES (${userId}, ${venueName}, ${email}, ${phone || null})
        RETURNING id, login_token::text AS login_token
      `;

      return { venueId: venue.id as string, loginToken: venue.login_token as string };
    });
    venueId = result.venueId;
    loginToken = result.loginToken;
  } catch (err) {
    console.error('[signup] insert failed:', err);
    return NextResponse.json({ error: 'Could not create account. Please try again.' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  const loginUrl = `${appUrl}/login/${loginToken}`;

  const emailResult = await sendEmail({
    to: email,
    subject: `Welcome to StoryPay — log in to finish setting up ${venueName}`,
    html: welcomeEmailHtml({ firstName, venueName, loginUrl }),
  }).catch((e) => {
    console.error('[signup] email send threw:', e);
    return { success: false, error: String(e) };
  });

  return NextResponse.json({
    ok: true,
    venue_id: venueId,
    email,
    email_sent: emailResult.success !== false,
    login_url: process.env.NODE_ENV === 'development' ? loginUrl : undefined,
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
