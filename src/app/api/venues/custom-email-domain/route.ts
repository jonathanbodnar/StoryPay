/**
 * /api/venues/custom-email-domain
 *
 * GET    — return current custom domain config for the venue
 * POST   — connect a new domain (creates it in Resend, stores DNS records)
 * PATCH  — update from_email / from_name without changing the domain
 * DELETE — disconnect domain (removes from Resend, clears DB columns)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  createResendDomain,
  deleteResendDomain,
  mapResendStatus,
  type ResendDnsRecord,
} from '@/lib/resend-domains';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(
      'custom_email_domain, resend_domain_id, custom_from_email, custom_from_name, custom_domain_status, custom_domain_dns_records, custom_domain_verified_at',
    )
    .eq('id', venueId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ domain: data });
}

// ─── POST (connect new domain) ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    domain?: string;
    from_email?: string;
    from_name?: string;
  };

  const rawDomain = (body.domain ?? '').trim().toLowerCase();
  if (!rawDomain || !rawDomain.includes('.')) {
    return NextResponse.json({ error: 'Enter a valid domain (e.g. yourvenue.com)' }, { status: 400 });
  }

  // Validate from_email if provided — must match the domain
  const fromEmail = (body.from_email ?? '').trim().toLowerCase();
  if (fromEmail && !fromEmail.endsWith(`@${rawDomain}`)) {
    return NextResponse.json(
      { error: `From email must end with @${rawDomain}` },
      { status: 400 },
    );
  }

  // Clean up old Resend domain if one already exists
  const { data: existing } = await supabaseAdmin
    .from('venues')
    .select('resend_domain_id')
    .eq('id', venueId)
    .single();
  if (existing?.resend_domain_id) {
    await deleteResendDomain(existing.resend_domain_id as string).catch(() => {});
  }

  // Create the domain in Resend
  const { domain: resendDomain, error: resendErr } = await createResendDomain(rawDomain);
  if (resendErr || !resendDomain) {
    return NextResponse.json(
      { error: resendErr ?? 'Failed to register domain with Resend' },
      { status: 500 },
    );
  }

  // Fetch venue name as fallback from_name
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', venueId)
    .single();

  const fromName = (body.from_name ?? '').trim() || (venue?.name as string) || '';
  const resolvedFromEmail = fromEmail || `hello@${rawDomain}`;

  const { error: dbErr } = await supabaseAdmin
    .from('venues')
    .update({
      custom_email_domain: rawDomain,
      resend_domain_id: resendDomain.id,
      custom_from_email: resolvedFromEmail,
      custom_from_name: fromName,
      custom_domain_status: mapResendStatus(resendDomain.status),
      custom_domain_dns_records: resendDomain.records,
      custom_domain_verified_at: null,
    })
    .eq('id', venueId);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    domain: {
      custom_email_domain: rawDomain,
      resend_domain_id: resendDomain.id,
      custom_from_email: resolvedFromEmail,
      custom_from_name: fromName,
      custom_domain_status: mapResendStatus(resendDomain.status),
      custom_domain_dns_records: resendDomain.records as ResendDnsRecord[],
      custom_domain_verified_at: null,
    },
  });
}

// ─── PATCH (update from_email / from_name only) ───────────────────────────────

export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    from_email?: string;
    from_name?: string;
  };

  const update: Record<string, string> = {};
  if (typeof body.from_email === 'string') update.custom_from_email = body.from_email.trim();
  if (typeof body.from_name === 'string') update.custom_from_name = body.from_name.trim();

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('venues').update(update).eq('id', venueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ─── DELETE (disconnect domain) ───────────────────────────────────────────────

export async function DELETE() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existing } = await supabaseAdmin
    .from('venues')
    .select('resend_domain_id')
    .eq('id', venueId)
    .single();

  if (existing?.resend_domain_id) {
    await deleteResendDomain(existing.resend_domain_id as string).catch(() => {});
  }

  await supabaseAdmin
    .from('venues')
    .update({
      custom_email_domain: null,
      resend_domain_id: null,
      custom_from_email: null,
      custom_from_name: null,
      custom_domain_status: 'not_configured',
      custom_domain_dns_records: null,
      custom_domain_verified_at: null,
    })
    .eq('id', venueId);

  return NextResponse.json({ ok: true });
}
