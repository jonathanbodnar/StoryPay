import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { parseEmailDefinition } from '@/lib/marketing-email-schema';
import { renderMarketingEmailHtml } from '@/lib/marketing-email-render';
import { injectVenueDataIntoDefinition } from '@/lib/marketing-email-injection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/marketing/automations/[id]/test-email
// Body: { stepOrder: number; toEmail: string }
// Renders the template assigned to the send_email step and delivers it to
// the supplied address — useful for preview without enrolling a real contact.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { stepOrder?: number; toEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { stepOrder, toEmail } = body;
  if (typeof stepOrder !== 'number') return NextResponse.json({ error: 'stepOrder required' }, { status: 400 });
  if (!toEmail?.trim()) return NextResponse.json({ error: 'toEmail required' }, { status: 400 });

  // Load the step
  const { data: step } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('step_type, config_json')
    .eq('automation_id', id)
    .eq('step_order', stepOrder)
    .maybeSingle();
  if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  if (step.step_type !== 'send_email') return NextResponse.json({ error: 'Step is not a send_email step' }, { status: 400 });

  const templateId = String((step.config_json as { template_id?: string }).template_id || '');
  if (!templateId) return NextResponse.json({ error: 'Step has no template assigned' }, { status: 400 });

  const { data: tmpl } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('name, subject, preheader, definition_json')
    .eq('id', templateId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!tmpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Load venue data for injection
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_full, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();

  const def = parseEmailDefinition(tmpl.definition_json);
  // Pass empty socials array — test preview doesn't need venue socials
  const injected = injectVenueDataIntoDefinition(def, []);

  // Placeholder merge vars for preview
  const mergeVars = {
    first_name: 'Preview',
    last_name: 'Contact',
    email: toEmail.trim(),
    venue_name: (venue?.name as string | null) ?? '',
    unsubscribe_url: '#',
    resubscribe_url: '#',
    manage_prefs_url: '#',
    preferences_url: '#',
    wedding_date: '',
    wedding_month: '',
    guest_count: '',
    open_pixel: '',
  };

  const html = renderMarketingEmailHtml(injected, mergeVars);

  const result = await sendEmail({
    to: toEmail.trim(),
    subject: `[TEST] ${tmpl.subject as string}`,
    html,
  });

  if (!result.success) return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 500 });
  return NextResponse.json({ sent: true, to: toEmail.trim() });
}
