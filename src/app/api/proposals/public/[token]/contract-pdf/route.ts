import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { signedContractPdf } from '@/lib/signed-contract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/proposals/public/[token]/contract-pdf — the signed contract as a
 * PDF, for the couple (from their proposal page) and the venue (from the
 * booking page). Only once it's signed; the link is as private as the
 * proposal link itself.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(`contract-pdf:${ip}`, 30, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many downloads. Please try again later.' }, { status: 429 });
  }
  try {
    const r = await signedContractPdf({ token });
    if (!r) return NextResponse.json({ error: 'There’s no signed contract for this proposal yet.' }, { status: 404 });
    return new NextResponse(new Uint8Array(r.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${r.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[contract-pdf] failed:', e);
    return NextResponse.json({ error: 'The PDF couldn’t be created. Please try again.' }, { status: 500 });
  }
}
