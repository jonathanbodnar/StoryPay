import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { parseEmailDefinition } from '@/lib/marketing-email-schema';
import { renderMarketingEmailHtml, mergeMarketingFields } from '@/lib/marketing-email-render';
import { injectVenueDataIntoDefinition } from '@/lib/marketing-email-injection';
import { logTestExecution } from '@/lib/workflow-execution-logs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/marketing/automations/[id]/test-email
// Body: { stepOrder: number; toEmail: string }
// Renders the email assigned to the send_email step (template or quick mode)
// and delivers it to the supplied address — useful for preview without
// enrolling a real contact.
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

  const cfg = step.config_json as {
    mode?: string; template_id?: string;
    from_name?: string; from_email?: string;
    cc?: string; bcc?: string;
    subject?: string; preheader?: string; body?: string;
  };
  const mode = cfg.mode === 'quick' ? 'quick' : (cfg.mode === 'template' ? 'template' : 'template');

  // Load venue (for default from-name + injection)
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_full, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();

  // Placeholder merge vars for preview — keys cover both canonical
  // ({{contact.x}}) and legacy flat ({{x}}) styles via renderMergeVars.
  const previewVars: Record<string, string> = {
    'contact.first_name': 'Preview',
    'contact.last_name':  'Contact',
    'contact.name':       'Preview Contact',
    'contact.email':      toEmail.trim(),
    'contact.phone':      '+1 555 555 5555',
    'venue.name':         (venue?.name as string | null) ?? 'Your Venue',
    'venue.owner_name':   '',
    'system.workflow_name': 'Test workflow',
    first_name:           'Preview',
    last_name:            'Contact',
    email:                toEmail.trim(),
    venue_name:           (venue?.name as string | null) ?? '',
    unsubscribe_url:      '#',
    resubscribe_url:      '#',
    manage_prefs_url:     '#',
    preferences_url:      '#',
    wedding_date:         '',
    wedding_month:        '',
    guest_count:          '',
    open_pixel:           '',
  };

  if (mode === 'quick') {
    // ── Quick compose preview ────────────────────────────────────────
    const subject   = mergeMarketingFields(String(cfg.subject ?? ''), previewVars);
    const bodyText  = mergeMarketingFields(String(cfg.body ?? ''),    previewVars);
    const preheader = mergeMarketingFields(String(cfg.preheader ?? ''), previewVars);
    const fromName  = mergeMarketingFields(String(cfg.from_name  ?? ''), previewVars).trim();
    const fromEmail = mergeMarketingFields(String(cfg.from_email ?? ''), previewVars).trim();

    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const looksLikeHtml = /<\/?[a-z][\s\S]*?>/i.test(bodyText);
    const bodyHtml = looksLikeHtml ? bodyText : escapeHtml(bodyText).replace(/\n/g, '<br>');
    const preheaderComment = preheader.trim()
      ? `<!-- preheader: ${preheader.replace(/<!--/g, '').slice(0, 200)} -->\n`
      : '';
    const html = `${preheaderComment}<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f6f7f9;font-family:Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">${bodyHtml}</div></body></html>`;

    const result = await sendEmail({
      to: toEmail.trim(),
      subject: `[TEST] ${subject || '(no subject)'}`,
      html,
      from: fromEmail
        ? { name: fromName || (venue?.name as string) || 'Venue', email: fromEmail }
        : { name: fromName || `${(venue?.name as string) || 'Venue'} via StoryVenue` },
    });
    void logTestExecution({
      automation_id: id,
      venue_id:      venueId,
      step_order:    stepOrder,
      step_type:     'send_email',
      status:        result.success ? 'success' : 'failed',
      recipient:     toEmail.trim(),
      error_text:    result.success ? undefined : (result.error ?? 'Send failed'),
    });
    if (!result.success) return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 500 });
    return NextResponse.json({ sent: true, to: toEmail.trim(), mode: 'quick' });
  }

  // ── Template-mode preview (existing behavior) ──────────────────────
  const templateId = String(cfg.template_id || '');
  if (!templateId) return NextResponse.json({ error: 'Step has no template assigned' }, { status: 400 });

  const { data: tmpl } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('name, subject, preheader, definition_json')
    .eq('id', templateId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!tmpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const def = parseEmailDefinition(tmpl.definition_json);
  const injected = injectVenueDataIntoDefinition(def, []);

  const html = renderMarketingEmailHtml(injected, previewVars);

  const result = await sendEmail({
    to: toEmail.trim(),
    subject: `[TEST] ${tmpl.subject as string}`,
    html,
  });
  void logTestExecution({
    automation_id: id,
    venue_id:      venueId,
    step_order:    stepOrder,
    step_type:     'send_email',
    status:        result.success ? 'success' : 'failed',
    recipient:     toEmail.trim(),
    error_text:    result.success ? undefined : (result.error ?? 'Send failed'),
  });

  if (!result.success) return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 500 });
  return NextResponse.json({ sent: true, to: toEmail.trim(), mode: 'template' });
}
