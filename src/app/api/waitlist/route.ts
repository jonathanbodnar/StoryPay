import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const NOTIFY_EMAIL = 'jason@storyvenuemarketing.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { firstName, lastName, email, phone, venueName, referralSource } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!firstName?.trim()) {
    return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  }

  const fullName = `${firstName.trim()} ${lastName?.trim() || ''}`.trim();

  // Try inserting — catch duplicate email gracefully
  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({
      email:           email.toLowerCase().trim(),
      name:            fullName,
      first_name:      firstName.trim(),
      last_name:       lastName?.trim() || null,
      phone:           phone?.trim() || null,
      venue_name:      venueName?.trim() || null,
      referral_source: referralSource?.trim() || null,
    });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ message: "You're already on the list!" }, { status: 200 });
    }
    console.error('[waitlist] insert error:', error.message, error.code);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }

  // Fire-and-forget email notification
  sendEmail({ firstName, lastName: lastName || '', email, phone: phone || '', venueName: venueName || '', referralSource: referralSource || '' });

  return NextResponse.json({ message: 'success' }, { status: 201 });
}

export async function GET() {
  const { count, error } = await supabaseAdmin
    .from('waitlist')
    .select('*', { count: 'exact', head: true });
  if (error) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: count ?? 0 });
}

async function sendEmail(data: {
  firstName: string; lastName: string; email: string;
  phone: string; venueName: string; referralSource: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[waitlist] RESEND_API_KEY not set');
    console.log('[waitlist] submission:', data);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StoryPay <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        reply_to: data.email,
        subject: 'New StoryPay invite requested',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#293745;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="color:white;font-size:18px;margin:0;font-weight:400">New StoryPay Invite Request</h1>
            </div>
            <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:160px">Name</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${data.firstName} ${data.lastName}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${data.email}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Phone</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${data.phone || 'Not provided'}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Venue</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;font-weight:600">${data.venueName || 'Not provided'}</td></tr>
                <tr><td style="padding:10px 0;color:#6b7280;font-size:13px">Heard via</td><td style="padding:10px 0;color:#111827;font-size:13px;font-weight:600">${data.referralSource || 'Not provided'}</td></tr>
              </table>
              <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px">
                <a href="${APP_URL}/admin" style="color:#293745;font-size:13px;font-weight:600;text-decoration:none">View in Admin Panel</a>
              </div>
            </div>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('[waitlist] Resend error:', res.status, txt);
    }
  } catch (err) {
    console.error('[waitlist] email failed:', err);
  }
}
