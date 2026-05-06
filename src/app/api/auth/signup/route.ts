import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { agencyCreateMerchant } from '@/lib/lunarpay';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SignupPayload {
  venue_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  password?: string;
  remember_me?: boolean;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request: NextRequest) {
  // ── US-only access control ────────────────────────────────────────────────
  // Check Cloudflare country header; fall back to other CDN headers. We only
  // block when a header is positively non-US — if no header is present (dev /
  // proxied requests) we let the request through so local testing still works.
  const cfCountry    = request.headers.get('CF-IPCountry');
  const vercelCountry = request.headers.get('X-Vercel-IP-Country');
  const detectedCountry = cfCountry || vercelCountry;
  if (detectedCountry && detectedCountry !== 'US' && detectedCountry !== 'XX' && detectedCountry !== 'T1') {
    return NextResponse.json(
      { error: 'StoryPay is currently only available in the United States. Stay tuned — we\'re expanding soon!' },
      { status: 403 }
    );
  }

  let payload: SignupPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueName  = (payload.venue_name ?? '').trim();
  const firstName  = (payload.first_name ?? '').trim();
  const lastName   = (payload.last_name ?? '').trim();
  const email      = (payload.email ?? '').trim().toLowerCase();
  const phone      = (payload.phone ?? '').trim();
  const password   = (payload.password ?? '').trim();
  const rememberMe = payload.remember_me ?? false;

  if (!venueName) return NextResponse.json({ error: 'Venue name is required.' }, { status: 400 });
  if (!firstName) return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
  if (!lastName)  return NextResponse.json({ error: 'Last name is required.' },  { status: 400 });
  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
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

  // Clean up any orphan auth.users row that has this email but no venue —
  // this happens when an account was deleted but the auth user wasn't
  // (e.g. manual SQL cleanup, old delete code, or partial rollback).
  // Without this cleanup, auth.admin.createUser fails with "already registered"
  // and the user can never re-register with the same email.
  try {
    let page = 1;
    let foundOrphan: string | null = null;
    while (page <= 5 && !foundOrphan) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      const users = list?.users ?? [];
      if (users.length === 0) break;
      const match = users.find((u) => (u.email || '').toLowerCase() === email);
      if (match) foundOrphan = match.id;
      if (users.length < 200) break;
      page += 1;
    }
    if (foundOrphan) {
      console.warn('[signup] removing orphan auth user', foundOrphan, 'for', email);
      await supabaseAdmin.auth.admin.deleteUser(foundOrphan);
    }
  } catch (e) {
    console.warn('[signup] orphan cleanup failed (non-fatal):', e);
  }

  let { data: authCreate, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      full_name:  fullName,
      first_name: firstName,
      last_name:  lastName,
      source:     'signup',
    },
  });

  // Last-resort recovery: if Supabase still says "already registered" even
  // though we have no venue with that email, look up the orphan via
  // getUserByEmail-style listing and delete it, then retry once.
  if (authErr && /already.*registered|already.*exists/i.test(authErr.message ?? '')) {
    try {
      let recovered = false;
      let page = 1;
      while (page <= 10 && !recovered) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        const users = list?.users ?? [];
        if (users.length === 0) break;
        const match = users.find((u) => (u.email || '').toLowerCase() === email);
        if (match) {
          await supabaseAdmin.auth.admin.deleteUser(match.id);
          recovered = true;
        }
        if (users.length < 1000) break;
        page += 1;
      }
      if (recovered) {
        const retry = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          password,
          user_metadata: {
            full_name:  fullName,
            first_name: firstName,
            last_name:  lastName,
            source:     'signup-retry',
          },
        });
        authCreate = retry.data;
        authErr = retry.error;
      }
    } catch (e) {
      console.error('[signup] orphan recovery failed:', e);
    }
  }

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

  // Hash password before storing
  const passwordHash = await bcrypt.hash(password, 12);

  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .insert({
      owner_id:         userId,
      name:             venueName,
      email,
      phone:            phone || null,
      password_hash:    passwordHash,
      setup_completed:  true,
      owner_first_name: firstName || null,
      owner_last_name:  lastName  || null,
    })
    .select('id')
    .single();

  if (venueErr || !venue) {
    console.error('[signup] venue insert failed:', venueErr);
    await rollback(`venue insert: ${venueErr?.message ?? 'unknown'}`);
    return NextResponse.json(
      { error: `Could not create venue: ${venueErr?.message ?? 'unknown error'}` },
      { status: 500 }
    );
  }

  // Auto-create the LunarPay merchant under our agency key so this venue can
  // start taking proposal payments under their own MID. The agency endpoint
  // returns merchantId/orgId/orgToken and a fresh lp_sk_/lp_pk_ pair
  // immediately, even though the merchant's onboarding status starts at
  // PENDING — it flips to ACTIVE later via the merchant.approved webhook
  // (handled in /api/webhooks/lunarpay) once Fortis approves the MPA.
  //
  // Best-effort only: if LP_AGENCY_KEY is unset (local dev) or the call
  // fails, we still let the user finish signup. They (or an admin) can
  // re-run agency provisioning later via /api/venues/onboard.
  if (process.env.LP_AGENCY_KEY) {
    try {
      const lpResult = await agencyCreateMerchant({
        email,
        password,
        firstName,
        lastName,
        phone: phone || '',
        businessName: venueName,
      });
      const merchant = (lpResult as { data?: Record<string, unknown> }).data
        || (lpResult as Record<string, unknown>);
      const onboardStatus = String(
        (merchant.onboardingStatus as string | undefined) ?? 'pending',
      ).toLowerCase();
      await supabaseAdmin
        .from('venues')
        .update({
          lunarpay_merchant_id:     (merchant.merchantId as number | string) ?? null,
          lunarpay_organization_id: (merchant.organizationId as number | string) ?? null,
          lunarpay_secret_key:      (merchant.secretKey as string) ?? null,
          lunarpay_publishable_key: (merchant.publishableKey as string) ?? null,
          lunarpay_org_token:       (merchant.orgToken as string) ?? null,
          onboarding_status:        onboardStatus,
        })
        .eq('id', venue.id);
    } catch (e) {
      console.error('[signup] LunarPay merchant create failed (non-fatal):', e);
    }
  }

  // Send welcome email (best-effort, non-blocking)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  try {
    await sendEmail({
      to: email,
      subject: `Welcome to StoryVenue — your account for ${venueName} is ready`,
      html: welcomeEmailHtml({ firstName, venueName, dashboardUrl: `${appUrl}/dashboard` }),
    });
  } catch (e) {
    console.warn('[signup] welcome email failed (non-fatal):', e);
  }

  // Log the user in immediately by setting the session cookie
  const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;
  const response = NextResponse.json({ ok: true, redirect: '/signup/plan' });
  response.cookies.set('venue_id', venue.id, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  });
  return response;
}

function welcomeEmailHtml({
  firstName,
  venueName,
  dashboardUrl,
}: {
  firstName: string;
  venueName: string;
  dashboardUrl: string;
}): string {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Welcome, ${escapeHtml(firstName)}!</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
      Your StoryVenue account for <strong>${escapeHtml(venueName)}</strong> is ready.
      Sign in anytime at <a href="${dashboardUrl}" style="color:#1b1b1b;text-decoration:underline;">app.storyvenue.com</a>
      using your email address and the password you created.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${dashboardUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Go to Dashboard</span>
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t sign up for StoryVenue, you can safely ignore this email.
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
