import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';

// Sample values used when previewing / test-sending
const SAMPLE_VARS: Record<string, Record<string, string>> = {
  invoice: {
    organization:   '{{organization}}',
    customer_name:  'Jane Smith',
    invoice_number: 'INV-2026-0001',
    amount:         '$4,500.00',
    due_date:       'June 15, 2026',
  },
  proposal: {
    organization:  '{{organization}}',
    customer_name: 'Jane Smith',
    amount:        '$4,500.00',
  },
  payment_confirmation: {
    organization:   '{{organization}}',
    customer_name:  'Jane Smith',
    amount:         '$4,500.00',
    date:           new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    payment_method: 'Visa ••••4242',
  },
  payment_notification: {
    organization:   '{{organization}}',
    customer_name:  'Jane Smith',
    customer_email: 'jane@example.com',
    amount:         '$4,500.00',
    net_amount:     '$4,376.25',
    fee:            '$123.75',
  },
  subscription_confirmation: {
    organization:      '{{organization}}',
    customer_name:     'Jane Smith',
    amount:            '$500.00',
    frequency:         'monthly',
    next_payment_date: 'May 7, 2026',
  },
  subscription_cancelled: {
    organization:  '{{organization}}',
    customer_name: 'Jane Smith',
  },
  payment_failed: {
    organization:  '{{organization}}',
    customer_name: 'Jane Smith',
    amount:        '$4,500.00',
    reason:        'Insufficient funds',
  },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type } = await params;
  const body = await request.json() as {
    to?: string;
    template?: {
      subject: string;
      heading: string;
      body: string;
      button_text?: string | null;
      footer?: string | null;
    };
  };

  if (!body.to || !body.to.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }
  const to = body.to;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  // Use the template passed from the editor (reflects unsaved edits).
  // Fall back to the saved DB version only if no template was supplied.
  let tmpl;
  if (body.template) {
    tmpl = {
      type,
      subject:     body.template.subject,
      heading:     body.template.heading,
      body:        body.template.body,
      button_text: body.template.button_text ?? null,
      footer:      body.template.footer      ?? null,
      enabled:     true,
    };
  } else {
    tmpl = await getVenueEmailTemplate(venueId, type);
  }

  if (!tmpl) {
    return NextResponse.json({ error: `Unknown template type: ${type}` }, { status: 400 });
  }

  const venueName = venue?.name || 'Your Venue';
  const sampleVars = SAMPLE_VARS[type] ?? {};
  const vars: Record<string, string> = {
    ...sampleVars,
    organization: venueName,
  };

  const subject = fillTemplate(tmpl.subject, vars);
  const html = buildEmailHtml({
    template:   tmpl,
    vars,
    actionUrl:  '#',
    brandColor: venue?.brand_color    || '#1b1b1b',
    logoUrl:    venue?.brand_logo_url || undefined,
    venueName,
  });

  const result = await sendEmail({ to, subject: `[TEST] ${subject}`, html });

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Failed to send test email' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
