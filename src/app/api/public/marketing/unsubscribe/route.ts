import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMarketingUnsubscribeToken } from '@/lib/marketing-email-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
  const parsed = verifyMarketingUnsubscribeToken(token);
  if (!parsed) {
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Invalid link</h1><p>This unsubscribe link has expired or is invalid.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  const { error } = await supabaseAdmin.from('marketing_email_suppressions').upsert(
    {
      lead_id: parsed.leadId,
      venue_id: parsed.venueId,
      reason: 'unsubscribe',
    },
    { onConflict: 'lead_id,venue_id' },
  );
  if (error) {
    console.error('[unsubscribe]', error);
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Something went wrong</h1><p>Please contact the venue directly.</p></body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;max-width:480px;margin:0 auto">
      <h1 style="font-weight:600">You are unsubscribed</h1>
      <p style="color:#52525b">You will no longer receive marketing emails from this venue through StoryPay.</p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
