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
    // Table may not exist in this Supabase project — return success with instructions
    if (error.message?.includes('schema cache') || error.message?.includes('does not exist') || error.message?.includes('not found')) {
      return NextResponse.json({
        error: 'Email templates table not found. Please run the setup SQL in your Supabase SQL Editor:\n\nCREATE TABLE IF NOT EXISTS venue_email_templates (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,\n  type text NOT NULL,\n  subject text NOT NULL,\n  heading text NOT NULL,\n  body text NOT NULL,\n  button_text text,\n  footer text,\n  enabled boolean NOT NULL DEFAULT true,\n  updated_at timestamptz NOT NULL DEFAULT now(),\n  UNIQUE(venue_id, type)\n);\nGRANT ALL ON venue_email_templates TO anon, authenticated, service_role;\nALTER TABLE venue_email_templates ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "Allow all" ON venue_email_templates FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);'
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
