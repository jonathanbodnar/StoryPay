/**
 * POST /api/admin/system-emails/test
 *
 * Send a test version of any system email to the specified address.
 * Uses live saved overrides (or defaults if not customized).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { SYSTEM_EMAIL_BY_KEY, SYSTEM_EMAIL_SAMPLE_VARS } from '@/lib/system-email-registry';
import { fillTemplate, buildEmailHtml } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';
import type { EmailTemplateRow } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

async function isAdmin(): Promise<string | null> {
  const c = await cookies();
  const adminEmail = c.get('admin_email')?.value;
  if (!adminEmail) return null;
  const { data } = await supabaseAdmin
    .from('super_admins')
    .select('id')
    .eq('email', adminEmail)
    .maybeSingle();
  return data ? adminEmail : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const adminEmail = await isAdmin();
  if (!adminEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { key: string; to: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { key, to } = body;
  if (!key || !to) return NextResponse.json({ error: 'key and to are required' }, { status: 400 });

  const def = SYSTEM_EMAIL_BY_KEY[key];
  if (!def) return NextResponse.json({ error: 'Unknown template key' }, { status: 404 });

  // For editable templates, load saved overrides; for read-only use defaults
  let subject     = def.defaults.subject;
  let heading     = def.defaults.heading;
  let bodyText    = def.defaults.body;
  let button_text = def.defaults.button_text ?? null;

  if (def.editable) {
    const { data } = await supabaseAdmin
      .from('system_email_templates')
      .select('subject, heading, body, button_text')
      .eq('key', key)
      .maybeSingle();
    if (data) {
      subject     = (data as any).subject     || subject;
      heading     = (data as any).heading     || heading;
      bodyText    = (data as any).body        || bodyText;
      button_text = (data as any).button_text !== undefined ? (data as any).button_text : button_text;
    }
  }

  const sampleVars = { ...(SYSTEM_EMAIL_SAMPLE_VARS[key] ?? {}) };
  if (!sampleVars.action_url) sampleVars.action_url = APP_URL;

  const tplRow: EmailTemplateRow = {
    type: key,
    subject,
    heading,
    body: bodyText,
    button_text,
    footer: null,
    enabled: true,
  };

  const html = buildEmailHtml({
    template: tplRow,
    vars: sampleVars,
    actionUrl: sampleVars.action_url,
    brandColor: '#1b1b1b',
    venueName: 'StoryVenue',
  });

  const resolvedSubject = fillTemplate(subject, sampleVars);

  await sendEmail({
    to,
    subject: `[Test] ${resolvedSubject}`,
    html,
  });

  return NextResponse.json({ ok: true, sent_to: to });
}
