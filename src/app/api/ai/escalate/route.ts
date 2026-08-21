import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';

const SUPPORT_EMAIL = 'clients@storyvenuemarketing.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { question, conversation, currentPage, supportNote } = await request.json();

  if (!supportNote?.trim()) {
    return NextResponse.json({ error: 'Please describe what you need help with.' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, email')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  });

  const convoText = (conversation as { role: string; content: string }[])
    .map((m) => `${m.role === 'user' ? 'Client' : 'Ask AI'}: ${m.content}`)
    .join('\n\n');

  const subject = `Support Request | ${venue.name} | ${venue.email || venueId}`;

  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sectionLabel = 'font-size:13px;font-weight:700;color:#111827;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;';
  const html = buildSystemEmail({
    title:   subject,
    heading: 'Support request — Ask AI',
    bodyHtml: `
      <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;text-align:center;">${esc(timestamp)}</p>

      <h2 style="${sectionLabel}">Client Information</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;text-align:left;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:180px">Venue Name</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${esc(venue.name)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${esc(venue.email || 'Not provided')}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Account ID</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(venue.id)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Dashboard Page</td><td style="padding:8px 0;color:#111827;font-size:13px">${esc(currentPage || 'Not captured')}</td></tr>
      </table>

      <h2 style="${sectionLabel}">What They Need Help With</h2>
      <div style="background:#f9f9f9;border-left:3px solid #1b1b1b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <p style="margin:0;color:#111827;font-size:14px;line-height:1.6;font-weight:600">${esc(supportNote)}</p>
      </div>

      <h2 style="${sectionLabel}">Original AI Question</h2>
      <div style="background:#f9f9f9;border-left:3px solid #d1d5db;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <p style="margin:0;color:#374151;font-size:13px;line-height:1.6">${esc(question)}</p>
      </div>

      <h2 style="${sectionLabel}">AI Conversation Summary</h2>
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:24px">
        <pre style="margin:0;font-size:12px;color:#374151;white-space:pre-wrap;font-family:inherit;line-height:1.7">${esc(convoText)}</pre>
      </div>

      <div style="background:#f9f9f9;border-radius:8px;padding:12px 16px;">
        <p style="margin:0;color:#111827;font-size:13px;font-weight:600">Action Required</p>
        <p style="margin:4px 0 0;color:#374151;font-size:13px">Client has interacted with Ask AI and requested human support. Please review and follow up directly at <a href="mailto:${esc(venue.email || '')}" style="color:#1b1b1b;">${esc(venue.email || 'no email on file')}</a>.</p>
      </div>`,
    cta:        { label: 'View in admin panel', url: `${APP_URL}/admin` },
    footerHtml: `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">Sent from StoryVenue Ask AI · ${esc(timestamp)}</p>`,
  });

  const result = await sendEmail({
    to: SUPPORT_EMAIL,
    replyTo: venue.email || SUPPORT_EMAIL,
    subject,
    html,
    from: { email: 'noreply@storyvenue.com', name: 'StoryVenue Ask AI' },
  });

  if (!result.success) {
    if (result.error?.includes('RESEND_API_KEY')) {
      return NextResponse.json(
        {
          error:
            'Email service not configured. Please contact clients@storyvenuemarketing.com directly.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error:
          result.error ||
          'Failed to send support email. Please email clients@storyvenuemarketing.com directly.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
