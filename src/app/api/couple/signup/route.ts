import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const display_name = (body.display_name ?? '').trim() || null;

  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: display_name ?? '', role: 'couple' },
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

  const { error: profErr } = await supabaseAdmin.from('couple_profiles').insert({
    id: uid,
    display_name,
  });

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
