import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const SUPPORT_EMAIL = 'clients@storyvenuemarketing.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { question, conversation, currentPage } = await request.json();

  // Fetch venue info for the email
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, email')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/New_York'
  });

  // Build conversation summary
  const convoText = (conversation as { role: string; content: string }[])
    .map(m => `${m.role === 'user' ? 'Client' : 'Ask AI'}: ${m.content}`)
    .join('\n\n');

  const subject = `Support Request | ${venue.name} | ${venue.email}`;

  const html = `
    <div style="font-family:'Open Sans',Arial,sans-serif;max-width:680px;margin:0 auto">
      <div style="background:#293745;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:18px;margin:0;font-weight:400">Support Request — Ask AI Escalation</h1>
        <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:6px 0 0">${timestamp}</p>
      </div>
      <div style="padding:28px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">

        <h2 style="font-size:14px;font-weight:700;color:#111827;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.05em">Client Information</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:180px">Venue Name</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${venue.name}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${venue.email || 'Not provided'}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Account ID</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-mono">${venue.id}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Dashboard Page</td><td style="padding:8px 0;color:#111827;font-size:13px">${currentPage || 'Not captured'}</td></tr>
        </table>

        <h2 style="font-size:14px;font-weight:700;color:#111827;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em">Original Question</h2>
        <div style="background:#f9fafb;border-left:3px solid #293745;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px">
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6">${question}</p>
        </div>

        <h2 style="font-size:14px;font-weight:700;color:#111827;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em">AI Conversation Summary</h2>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px;max-height:400px;overflow:auto">
          <pre style="margin:0;font-size:12px;color:#374151;white-space:pre-wrap;font-family:'Open Sans',Arial,sans-serif;line-height:1.7">${convoText}</pre>
        </div>

        <div style="background:#fef3c7;border-radius:8px;padding:12px 16px;margin-bottom:24px">
          <p style="margin:0;color:#92400e;font-size:13px;font-weight:600">Recommended Next Step</p>
          <p style="margin:4px 0 0;color:#78350f;font-size:13px">The client has already interacted with Ask AI and needs human assistance. Please review the conversation above and follow up directly.</p>
        </div>

        <div style="text-align:center;border-top:1px solid #e5e7eb;padding-top:16px">
          <a href="${APP_URL}/admin" style="color:#293745;font-size:12px;font-weight:600;text-decoration:none">View in Admin Panel →</a>
          <p style="color:#9ca3af;font-size:11px;margin:8px 0 0">Sent from StoryPay Ask AI · ${timestamp}</p>
        </div>
      </div>
    </div>
  `;

  // Send via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'StoryPay Ask AI <onboarding@resend.dev>',
          to: [SUPPORT_EMAIL],
          reply_to: venue.email || SUPPORT_EMAIL,
          subject,
          html,
        }),
      });
      if (!res.ok) console.error('[escalate] Resend error:', await res.text());
    } catch (err) {
      console.error('[escalate] Email failed:', err);
    }
  } else {
    console.log('[escalate] No RESEND_API_KEY — would send:', subject);
  }

  return NextResponse.json({ success: true });
}
