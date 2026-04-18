import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMarketingOpenToken } from '@/lib/marketing-email-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 1×1 transparent GIF */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Marketing email open pixel. Updates marketing_campaign_recipients.opened_at once.
 */
export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get('t')?.trim() ?? '';
  const v = verifyMarketingOpenToken(t);
  if (!v) {
    return new NextResponse(PIXEL, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  const { error } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .update({
      opened_at: new Date().toISOString(),
    })
    .eq('id', v.recipientId)
    .is('opened_at', null);

  if (error) {
    console.error('[email-open]', error.message);
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
