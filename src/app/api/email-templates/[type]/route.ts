import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { type } = await params;
  const { subject, heading, body, button_text, footer, enabled } = await request.json();

  // Try upsert
  const { data, error } = await supabaseAdmin
    .from('venue_email_templates')
    .upsert(
      { venue_id: venueId, type, subject, heading, body, button_text, footer, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'venue_id,type' }
    )
    .select().single();

  if (error) {
    console.error('[email-templates] upsert error:', error.message);
    // Table missing from this Supabase project (should never happen in prod —
    // it's created by migrations). Return a generic error; the fix is to run
    // the pending DB migrations, NOT to hand-create a wide-open "Allow all"
    // RLS policy (which is exactly the anon/authenticated hole migration 144
    // closed).
    if (error.message?.includes('schema cache') || error.message?.includes('does not exist') || error.message?.includes('not found')) {
      return NextResponse.json({
        error: 'Email templates are temporarily unavailable. Please try again shortly or contact support if this persists.',
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
