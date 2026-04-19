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
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Invalid link</h1><p>This link has expired or is invalid.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const { error: delErr } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .delete()
    .eq('venue_id', parsed.venueId)
    .eq('lead_id', parsed.leadId);
  if (delErr) {
    console.error('[resubscribe] delete suppression', delErr);
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Something went wrong</h1><p>Please contact the venue directly.</p></body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const { error: upErr } = await supabaseAdmin
    .from('leads')
    .update({ marketing_email_opt_in: true })
    .eq('id', parsed.leadId)
    .eq('venue_id', parsed.venueId);
  if (upErr) {
    console.error('[resubscribe] opt in', upErr);
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Something went wrong</h1><p>Please contact the venue directly.</p></body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;max-width:480px;margin:0 auto">
      <h1 style="font-weight:600">You are subscribed again</h1>
      <p style="color:#52525b">You can receive marketing emails from this venue through StoryPay.</p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
