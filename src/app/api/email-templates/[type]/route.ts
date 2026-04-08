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

  const { data, error } = await supabaseAdmin
    .from('venue_email_templates')
    .upsert(
      { venue_id: venueId, type, subject, heading, body, button_text, footer, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'venue_id,type' }
    )
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
