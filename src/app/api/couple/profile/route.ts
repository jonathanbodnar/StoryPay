import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function str(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || null;
}

const REQUIRED_FIELDS = ['first_name', 'last_name', 'phone'] as const;

export async function PATCH(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Validate required fields ──────────────────────────────────────────
  for (const field of REQUIRED_FIELDS) {
    const v = body[field];
    if (typeof v !== 'string' || !v.trim()) {
      const label = field.replace('_', ' ');
      return NextResponse.json(
        { error: `${label.charAt(0).toUpperCase() + label.slice(1)} is required.` },
        { status: 400 },
      );
    }
  }

  // Optional: allow updating the auth email if provided + different
  const newEmailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (newEmailRaw && newEmailRaw !== (user.email ?? '').toLowerCase()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmailRaw)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }
    const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: newEmailRaw,
      email_confirm: true,
    });
    if (emailErr) {
      const m = emailErr.message ?? '';
      if (/registered|exists|duplicate/i.test(m)) {
        return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 });
      }
      console.error('[couple/profile] email update', emailErr);
      return NextResponse.json({ error: m || 'Could not update email' }, { status: 500 });
    }
  }

  // ── Build profile patch ───────────────────────────────────────────────
  const firstName = (body.first_name as string).trim();
  const lastName = (body.last_name as string).trim();
  const derivedDisplay = `${firstName} ${lastName}`.trim();

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    first_name: firstName,
    last_name: lastName,
    // Keep display_name in sync for backwards compatibility
    display_name: derivedDisplay,
  };

  if ('phone' in body) patch.phone = str(body.phone, 40) ?? null;
  if ('address_line1' in body) patch.address_line1 = str(body.address_line1, 200) ?? null;
  if ('address_line2' in body) patch.address_line2 = str(body.address_line2, 200) ?? null;
  if ('city' in body) patch.city = str(body.city, 120) ?? null;
  if ('state' in body) patch.state = str(body.state, 80) ?? null;
  if ('postal_code' in body) patch.postal_code = str(body.postal_code, 30) ?? null;
  if ('country' in body) patch.country = str(body.country, 80) ?? null;
  if ('instagram_url' in body) patch.instagram_url = str(body.instagram_url, 500) ?? null;
  if ('facebook_url' in body) patch.facebook_url = str(body.facebook_url, 500) ?? null;
  if ('tiktok_url' in body) patch.tiktok_url = str(body.tiktok_url, 500) ?? null;
  if ('pinterest_url' in body) patch.pinterest_url = str(body.pinterest_url, 500) ?? null;

  if ('wedding_date' in body) {
    const w = body.wedding_date;
    if (w === null || w === '') patch.wedding_date = null;
    else if (typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w)) patch.wedding_date = w;
  }

  const { data: existing } = await supabaseAdmin
    .from('couple_profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin.from('couple_profiles').insert({ id: user.id });
  }

  // First attempt with first_name/last_name. If schema cache rejects them,
  // retry without those fields and just keep display_name in sync.
  let { data, error } = await supabaseAdmin
    .from('couple_profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .maybeSingle();

  if (error && /first_name|last_name/i.test(error.message)) {
    const fallback = { ...patch };
    delete (fallback as Record<string, unknown>).first_name;
    delete (fallback as Record<string, unknown>).last_name;
    const retry = await supabaseAdmin
      .from('couple_profiles')
      .update(fallback)
      .eq('id', user.id)
      .select('*')
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error('[couple/profile]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    profile: data,
    email: newEmailRaw && newEmailRaw !== (user.email ?? '').toLowerCase() ? newEmailRaw : user.email,
  });
}
