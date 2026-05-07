/**
 * POST /api/venues/custom-email-domain/verify
 *
 * Polls Resend for the current DNS verification status of the venue's custom
 * domain and updates the DB. Call this when the venue clicks "Check status".
 */

import { NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { getResendDomain, verifyResendDomain, mapResendStatus } from '@/lib/resend-domains';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('resend_domain_id, custom_domain_status')
    .eq('id', venueId)
    .single();

  const domainId = venue?.resend_domain_id as string | null;
  if (!domainId) {
    return NextResponse.json({ error: 'No custom domain configured' }, { status: 400 });
  }

  // Trigger re-verification, then fetch latest status
  await verifyResendDomain(domainId).catch(() => {});
  const { domain: resendDomain, error } = await getResendDomain(domainId);
  if (error || !resendDomain) {
    return NextResponse.json({ error: error ?? 'Could not reach Resend' }, { status: 500 });
  }

  const newStatus = mapResendStatus(resendDomain.status);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('venues')
    .update({
      custom_domain_status: newStatus,
      custom_domain_dns_records: resendDomain.records,
      ...(newStatus === 'verified' ? { custom_domain_verified_at: now } : {}),
    })
    .eq('id', venueId);

  return NextResponse.json({
    status: newStatus,
    records: resendDomain.records,
    verified_at: newStatus === 'verified' ? now : null,
  });
}
