import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyCreateMerchant } from '@/lib/lunarpay';
import { getLunarPayAdminSummary } from '@/lib/lunarpay-venue-admin';
import { sendEmail } from '@/lib/email';

const REDACT_VENUE_KEYS = new Set(['lunarpay_secret_key', 'lunarpay_org_token']);

async function verifyAdmin() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  return adminToken && adminToken === process.env.ADMIN_SECRET;
}

export async function GET() {
  try {
    if (!(await verifyAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({
        error: 'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Railway.',
      }, { status: 500 });
    }

    const { data: venues, error } = await supabaseAdmin
      .from('venues')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 500 });
    }

    const { data: planRows } = await supabaseAdmin.from('directory_plans').select('id, name, slug');
    const planById = new Map((planRows || []).map((p) => [p.id as string, p]));

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
    const venuesWithLinks = (venues || []).map((venue: Record<string, unknown>) => {
      const lpSummary = getLunarPayAdminSummary(venue);
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(venue)) {
        if (REDACT_VENUE_KEYS.has(k)) continue;
        safe[k] = v;
      }
      const pid = safe.directory_plan_id as string | null | undefined;
      const directory_plans = pid ? planById.get(pid) ?? null : null;
      return {
        ...safe,
        directory_plans,
        login_url: safe.login_token ? `${appUrl}/login/${safe.login_token}` : null,
        lunarpay_admin: lpSummary,
      };
    });

    return NextResponse.json({ venues: venuesWithLinks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await verifyAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name, email, firstName, lastName, phone, ghlLocationId,
      // Legacy-client friendly options:
      skipLunarPay = false, // when true, don't try to provision a merchant
      sendInvite   = true,  // email the owner a magic login link after create
      isLegacy     = false, // mark venue as a legacy-migration import
    } = body as {
      name?: string; email?: string; firstName?: string; lastName?: string;
      phone?: string; ghlLocationId?: string;
      skipLunarPay?: boolean; sendInvite?: boolean; isLegacy?: boolean;
    };

    if (!name || !email || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'name, email, firstName, and lastName are required' },
        { status: 400 }
      );
    }

    let merchantData: Record<string, unknown> = {};
    let lunarPayWarning: string | null = null;

    if (!skipLunarPay && process.env.LP_AGENCY_KEY) {
      try {
        const password = `SP_${crypto.randomUUID().slice(0, 12)}`;

        const lpResult = await agencyCreateMerchant({
          email,
          password,
          firstName,
          lastName,
          phone: phone || '',
          businessName: name,
        });

        const merchant = lpResult.data || lpResult;
        merchantData = {
          lunarpay_merchant_id: merchant.merchantId,
          lunarpay_organization_id: merchant.organizationId,
          lunarpay_secret_key: merchant.secretKey,
          lunarpay_publishable_key: merchant.publishableKey,
          lunarpay_org_token: merchant.orgToken,
          onboarding_status: (merchant.onboardingStatus || 'pending').toLowerCase(),
          onboarding_mpa_url: merchant.mpaEmbedUrl || null,
        };
      } catch (lpErr) {
        // Don't block legacy-migration flows on LunarPay outages — surface
        // the warning back to the admin so they can retry merchant
        // provisioning manually later.
        const msg = lpErr instanceof Error ? lpErr.message : String(lpErr);
        console.warn('[admin venue create] LunarPay merchant create failed, continuing:', msg);
        lunarPayWarning = `LunarPay merchant could not be created (${msg}). Venue saved without payment processing — provision later.`;
      }
    }

    const { data: venue, error: venueError } = await supabaseAdmin
      .from('venues')
      .insert({
        name,
        email,
        phone: phone || null,
        ghl_location_id: ghlLocationId || null,
        onboarding_status: 'pending',
        ...merchantData,
      })
      .select()
      .single();

    if (venueError) {
      return NextResponse.json({ error: `DB error: ${venueError.message}` }, { status: 500 });
    }

    const appUrl  = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
    const loginUrl = venue.login_token ? `${appUrl}/login/${venue.login_token}` : null;

    // Optionally send the owner a welcome email with the magic login link.
    let inviteSent = false;
    let inviteError: string | null = null;
    if (sendInvite && loginUrl) {
      try {
        await sendEmail({
          to: email,
          subject: `Welcome to StoryVenue — ${name}`,
          html: legacyInviteEmailHtml({
            firstName,
            venueName: name,
            loginUrl,
            isLegacy,
          }),
        });
        inviteSent = true;
      } catch (mailErr) {
        const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
        console.error('[admin venue create] invite email failed:', msg);
        inviteError = `Venue created, but invite email failed: ${msg}. Copy the login link below and send it manually.`;
      }
    }

    return NextResponse.json({
      venue: {
        ...venue,
        login_url: loginUrl,
      },
      inviteSent,
      inviteError,
      lunarPayWarning,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}

function legacyInviteEmailHtml(args: {
  firstName: string;
  venueName: string;
  loginUrl: string;
  isLegacy: boolean;
}): string {
  const { firstName, venueName, loginUrl, isLegacy } = args;
  const intro = isLegacy
    ? `Welcome to StoryVenue! We&apos;ve set up your new subaccount as part of your migration from your previous platform. Everything you need to manage <strong>${venueName}</strong> lives in one place now — contacts, calendar, conversations, proposals, payments, and more.`
    : `Welcome to StoryVenue! We&apos;ve set up your subaccount for <strong>${venueName}</strong>. Click below to log in and finish getting things ready.`;

  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Your account is ready, ${firstName}</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">${intro}</p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Click the button below to log in. This link is unique to you — no password required.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${loginUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Log In to StoryVenue</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy and paste this link:<br>
      <a href="${loginUrl}" style="color:#1b1b1b;text-decoration:underline;word-break:break-all">${loginUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 12px">
      <strong>What's next:</strong>
    </p>
    <ul style="color:#6b7280;font-size:13px;line-height:1.7;margin:0 0 16px;padding-left:20px">
      <li>Confirm your venue details and connect your calendar</li>
      <li>Import or sync your contacts</li>
      <li>Set up payment processing if you take deposits</li>
      <li>Reach out to support@storyvenue.com if you need anything</li>
    </ul>
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      You&apos;re receiving this because the StoryVenue concierge team set up your subaccount.
    </p>
  </div>
</div>`;
}
