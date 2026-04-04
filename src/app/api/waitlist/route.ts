import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const NOTIFY_EMAIL = 'jason@storyvenuemarketing.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

async function sendNotificationEmail(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  venueName: string;
}) {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.warn('[waitlist] RESEND_API_KEY not set — skipping email. Add it to Railway env vars.');
    console.log('[waitlist] New submission:', data);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'StoryPay <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        reply_to: data.email,
        subject: 'New StoryPay invite requested',
        html: buildEmailHtml(data),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[waitlist] Resend error:', res.status, body);
    } else {
      console.log('[waitlist] Email sent to', NOTIFY_EMAIL);
    }
  } catch (err) {
    console.error('[waitlist] Email send failed:', err);
  }
}

function buildEmailHtml(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  venueName: string;
}) {
  return `
    <div style="font-family: 'Open Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background-color: #293745; padding: 28px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; font-size: 20px; margin: 0; font-weight: 400;">
          New Early Access Request
        </h1>
      </div>
      <div style="padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px; width: 140px;">Name</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 13px; font-weight: 600;">${data.firstName} ${data.lastName}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px;">Email</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 13px; font-weight: 600;">${data.email}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px;">Phone</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 13px; font-weight: 600;">${data.phone || 'Not provided'}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #6b7280; font-size: 13px;">Venue</td>
            <td style="padding: 10px 0; color: #111827; font-size: 13px; font-weight: 600;">${data.venueName || 'Not provided'}</td>
          </tr>
        </table>
        <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px;">
          <a href="${APP_URL}/admin" style="color: #293745; font-size: 13px; font-weight: 600; text-decoration: none;">
            View in Admin Panel →
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 11px; margin-top: 24px;">Sent from StoryPay waitlist · ${new Date().toLocaleString()}</p>
      </div>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { firstName, lastName, email, phone, venueName } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!firstName?.trim()) {
    return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  }

  const fullName = `${firstName.trim()} ${lastName?.trim() || ''}`.trim();

  const { data: result, error } = await supabaseAdmin.rpc('insert_waitlist', {
    p_email:      email.toLowerCase().trim(),
    p_name:       fullName,
    p_first_name: firstName.trim(),
    p_last_name:  lastName?.trim() || null,
    p_phone:      phone?.trim() || null,
    p_venue_name: venueName?.trim() || null,
  });

  if (error) {
    console.error('[waitlist] RPC error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }

  if (result === 'duplicate') {
    return NextResponse.json({ message: "You're already on the list!" }, { status: 200 });
  }

  // Fire-and-forget notification
  sendNotificationEmail({ firstName, lastName: lastName || '', email, phone: phone || '', venueName: venueName || '' });

  return NextResponse.json({ message: 'success' }, { status: 201 });
}

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc('count_waitlist');
  if (error) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: data ?? 0 });
}
