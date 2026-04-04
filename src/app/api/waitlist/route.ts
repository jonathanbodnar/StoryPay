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
  // Send via GHL agency email if configured, otherwise use fetch to a mail API
  const apiKey = process.env.GHL_AGENCY_API_KEY || process.env.GHL_CLIENT_SECRET;

  // Try sending via a simple SMTP relay using fetch to an email API
  // Falls back to logging if no email service configured
  try {
    // Use Resend if configured
    if (process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'StoryPay <onboarding@storypay.io>',
          to: [NOTIFY_EMAIL],
          subject: `New Early Access Request — ${data.venueName || data.email}`,
          html: buildEmailHtml(data),
        }),
      });
      return;
    }

    // Fallback: log to console (visible in Railway/Vercel logs)
    console.log('[waitlist] New early access request:', data);
    void apiKey; // suppress unused warning
  } catch (err) {
    console.error('[waitlist] Email notification failed:', err);
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
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 13px; font-weight: 600;">${data.phone || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #6b7280; font-size: 13px;">Venue</td>
            <td style="padding: 10px 0; color: #111827; font-size: 13px; font-weight: 600;">${data.venueName || '—'}</td>
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

  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({
      email:      email.toLowerCase().trim(),
      name:       fullName,
      first_name: firstName.trim(),
      last_name:  lastName?.trim() || null,
      phone:      phone?.trim() || null,
      venue_name: venueName?.trim() || null,
    });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ message: "You're already on the list!" }, { status: 200 });
    }
    console.error('[waitlist] DB insert error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }

  // Fire-and-forget notification
  sendNotificationEmail({ firstName, lastName: lastName || '', email, phone: phone || '', venueName: venueName || '' });

  return NextResponse.json({ message: 'success' }, { status: 201 });
}

export async function GET() {
  const { count } = await supabaseAdmin
    .from('waitlist')
    .select('*', { count: 'exact', head: true });
  return NextResponse.json({ count: count ?? 0 });
}
