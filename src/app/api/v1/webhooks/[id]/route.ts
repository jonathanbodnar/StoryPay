export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/** DELETE — remove a webhook subscription (Zapier calls this when a Zap is disabled). */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { error } = await supabaseAdmin
    .from('venue_webhook_subscriptions')
    .delete()
    .eq('venue_id', auth.venueId)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
}
