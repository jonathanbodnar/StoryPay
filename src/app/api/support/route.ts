import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { subject, category, message, email } = await request.json();

  if (!subject || !message || !email) {
    return NextResponse.json(
      { error: 'subject, message, and email are required' },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      venue_id: venueId,
      subject,
      category: category || 'general',
      message,
      email,
      status: 'open',
    });

  if (error) {
    console.error('Support ticket insert failed:', error);
    return NextResponse.json({ error: 'Failed to submit ticket' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
