/**
 * GET /api/admin/system-emails/preview?key=<key>
 *
 * Returns the rendered HTML of any system email using sample data.
 * Uses live saved overrides (or defaults if not customized).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { SYSTEM_EMAIL_BY_KEY, SYSTEM_EMAIL_SAMPLE_VARS } from '@/lib/system-email-registry';
import { buildEmailHtml } from '@/lib/email-templates';
import type { EmailTemplateRow } from '@/lib/email-templates';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = await getAdminIdentity();
  if (!id.isMasterSuperAdmin && !(id.member && id.allowedTabs.has('system-emails'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get('key') || '';
  const def = SYSTEM_EMAIL_BY_KEY[key];
  if (!def) return NextResponse.json({ error: 'Unknown key' }, { status: 404 });

  let heading     = def.defaults.heading;
  let bodyText    = def.defaults.body;
  let button_text = def.defaults.button_text ?? null;
  let subject     = def.defaults.subject;

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

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
