/**
 * POST /api/staging/inbound-email — hand the test copy an email as if Resend had
 * received it; returns its email_id for the email.received webhook.
 * Test copy only (behind its password page); not found on the live site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStaging } from '@/lib/staging';
import { storeFakeInboundEmail, type FakeInboundEmail } from '@/lib/staging-inbound';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const email = (await request.json().catch(() => null)) as FakeInboundEmail | null;
  if (!email?.from || !Array.isArray(email.to) || !email.to.length || typeof email.subject !== 'string') {
    return NextResponse.json({ error: 'from, to[] and subject are required' }, { status: 400 });
  }
  return NextResponse.json({ email_id: storeFakeInboundEmail(email) });
}
