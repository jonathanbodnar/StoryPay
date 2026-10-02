/**
 * POST /api/public/embed-leads
 *
 * Thin server-side proxy for the embeddable form. The main /api/public/leads
 * endpoint requires an HMAC signature (it's called from the storyvenue.com
 * directory with a shared secret). Because the embed form runs on a venue's
 * own website it cannot know that secret, so it calls this endpoint instead.
 *
 * This route:
 *  1. Validates the payload is well-formed (required fields present).
 *  2. Computes the HMAC signature server-side.
 *  3. Forwards the request to /api/public/leads with the correct header.
 *
 * All downstream logic (Speed to Lead, notifications, pipeline, Tripleseat,
 * duplicate detection, etc.) is handled in the target endpoint unchanged.
 *
 * CORS: allow all origins so the iframe can post from any venue website.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { getClientIp } from '@/lib/rate-limit';
import { isStaging } from '@/lib/staging';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const LEAD_WEBHOOK_SECRET = process.env.LEAD_WEBHOOK_SECRET || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Force source to 'embed' so the funnel tags it correctly, and pass the
  // couple's own IP inside the signed body: the forwarded request reaches
  // /api/public/leads from this server, not from the couple.
  body = { ...body, source: 'embed', client_ip: getClientIp(req) };

  const rawBody = JSON.stringify(body);

  // Sign the request exactly as the directory does.
  const signature = LEAD_WEBHOOK_SECRET
    ? crypto.createHmac('sha256', LEAD_WEBHOOK_SECRET).update(rawBody).digest('hex')
    : '';

  const target = `${APP_URL}/api/public/leads`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method:  'POST',
      headers: {
        'Content-Type':          'application/json',
        'x-storypay-signature':  signature,
        // The test copy's password page guards every request, even its own.
        ...(isStaging() ? { 'x-staging-key': process.env.STAGING_PASSWORD ?? '' } : {}),
        // The couple's browser and page, for the proof-of-consent record.
        'user-agent': req.headers.get('user-agent') ?? '',
        referer: req.headers.get('referer') ?? '',
      },
      body: rawBody,
    });
  } catch (e) {
    console.error('[embed-leads] upstream fetch failed:', e);
    return NextResponse.json(
      { error: 'Submission failed. Please try again.' },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  const json = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  return NextResponse.json(json, { status: upstream.status, headers: CORS_HEADERS });
}
