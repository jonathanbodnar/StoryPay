import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    display_name?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const first_name = (body.first_name ?? '').trim();
  const last_name = (body.last_name ?? '').trim();
  const phone = (body.phone ?? '').trim();
  // display_name kept for backwards compat; derive from first+last if not given
  const display_name =
    (body.display_name ?? '').trim() ||
    [first_name, last_name].filter(Boolean).join(' ') ||
    null;

  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }
  if (!first_name) {
    return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
  }
  if (!last_name) {
    return NextResponse.json({ error: 'Last name is required.' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
  }

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone: phone || undefined,
    user_metadata: { display_name: display_name ?? '', first_name, last_name, role: 'couple' },
  });

  if (authErr || !created?.user) {
    const msg = authErr?.message ?? 'Could not create account';
    if (/already|registered|exists/i.test(msg)) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }
    console.error('[couple/signup]', authErr);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const uid = created.user.id;

  // Insert couple_profiles. Try with first_name / last_name; if columns
  // don't exist yet (migration 077 not run), fall back to display_name only.
  const fullInsert: Record<string, unknown> = {
    id: uid,
    display_name,
    first_name,
    last_name,
    phone,
  };
  let { error: profErr } = await supabaseAdmin.from('couple_profiles').insert(fullInsert);

  if (profErr && /first_name|last_name/i.test(profErr.message)) {
    // Schema cache stale — retry with legacy columns only
    const fallback = { id: uid, display_name, phone };
    const retry = await supabaseAdmin.from('couple_profiles').insert(fallback);
    profErr = retry.error;
  }

  if (profErr) {
    console.error('[couple/signup] couple_profiles insert', profErr);
    try {
      await supabaseAdmin.auth.admin.deleteUser(uid);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      { error: `Account created but profile failed: ${profErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
