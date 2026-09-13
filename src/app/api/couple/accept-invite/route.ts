import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { checkPassword } from '@/lib/password-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CollaboratorRow {
  id: string;
  couple_wedding_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  access_level: string | null;
  role: string | null;
  status: string;
  collaborator_user_id: string | null;
}

async function loadInviteByToken(token: string): Promise<CollaboratorRow | null> {
  const { data } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .select('id, couple_wedding_id, name, email, phone, access_level, role, status, collaborator_user_id')
    .eq('invite_token', token)
    .maybeSingle();
  return (data as CollaboratorRow | null) ?? null;
}

/** Venue + inviting-couple context shown on the accept page. */
async function inviteContext(weddingId: string) {
  const { data: wedding } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, couple_id, venue_id')
    .eq('id', weddingId)
    .maybeSingle();
  const w = wedding as { couple_id: string | null; venue_id: string } | null;
  if (!w) return { venueName: null as string | null, inviterName: null as string | null };

  const [{ data: venue }, { data: profile }] = await Promise.all([
    supabaseAdmin.from('venues').select('name').eq('id', w.venue_id).maybeSingle(),
    w.couple_id
      ? supabaseAdmin
          .from('couple_profiles')
          .select('display_name, first_name, last_name, partner_first_name')
          .eq('id', w.couple_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; partner_first_name?: string | null }
    | null;
  const inviterName =
    [p?.first_name, p?.partner_first_name].filter(Boolean).join(' & ').trim() ||
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() ||
    p?.display_name?.trim() ||
    null;
  return { venueName: (venue as { name?: string | null } | null)?.name ?? null, inviterName };
}

/** GET ?token= — public invite context for the accept page. */
export async function GET(request: NextRequest) {
  const token = (new URL(request.url).searchParams.get('token') ?? '').trim();
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  const invite = await loadInviteByToken(token);
  if (!invite || invite.status === 'revoked') {
    return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  }

  const { venueName, inviterName } = await inviteContext(invite.couple_wedding_id);
  return NextResponse.json({
    invite: {
      name: invite.name,
      email: invite.email,
      phone: invite.phone,
      access_level: invite.access_level === 'edit' ? 'edit' : 'view',
      role: invite.role,
      status: invite.status,
      alreadyAccepted: invite.status === 'active',
    },
    venueName,
    inviterName,
  });
}

/**
 * POST — accept an invite. Two paths:
 *   - Signed in (Bearer): bind the current couple account to this invite.
 *   - Not signed in: { token, password } creates a couple account using the
 *     invite's name/email/phone, then binds it. Returns { email } so the client
 *     can sign in.
 */
export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const token = (body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  const invite = await loadInviteByToken(token);
  if (!invite || invite.status === 'revoked') {
    return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  }

  // Path 1: already signed in — bind this account.
  const signedIn = await getCoupleAuthUser(request);
  if (signedIn) {
    const { error } = await supabaseAdmin
      .from('wedding_planner_collaborators')
      .update({
        collaborator_user_id: signedIn.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id)
      .neq('status', 'revoked');
    if (error) {
      console.error('[couple/accept-invite bind]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, email: signedIn.email ?? invite.email });
  }

  // Path 2: sign up a new couple account from the invite details.
  const email = (invite.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'This invite has no email on file.' }, { status: 400 });
  const password = body.password ?? '';
  const pwCheck = checkPassword(password);
  if (!pwCheck.valid) return NextResponse.json({ error: pwCheck.message }, { status: 400 });

  const fullName = (invite.name ?? '').trim();
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(' ');
  const phone = (invite.phone ?? '').trim();

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone: phone || undefined,
    user_metadata: {
      display_name: fullName,
      first_name: firstName ?? '',
      last_name: lastName,
      role: 'couple',
    },
  });

  if (authErr || !created?.user) {
    const msg = authErr?.message ?? 'Could not create account';
    if (/already|registered|exists/i.test(msg)) {
      return NextResponse.json(
        { error: 'An account with that email already exists. Please log in to accept this invite.', accountExists: true },
        { status: 409 },
      );
    }
    console.error('[couple/accept-invite signup]', authErr);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const uid = created.user.id;
  const { error: profErr } = await supabaseAdmin.from('couple_profiles').insert({
    id: uid,
    display_name: fullName || null,
    first_name: firstName ?? null,
    last_name: lastName || null,
    phone: phone || null,
  });
  if (profErr) {
    console.error('[couple/accept-invite] profile insert', profErr);
    try {
      await supabaseAdmin.auth.admin.deleteUser(uid);
    } catch {
      /* ignore cleanup failure */
    }
    return NextResponse.json({ error: `Account created but profile failed: ${profErr.message}` }, { status: 500 });
  }

  const { error: bindErr } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .update({ collaborator_user_id: uid, status: 'active', accepted_at: new Date().toISOString() })
    .eq('id', invite.id)
    .neq('status', 'revoked');
  if (bindErr) {
    console.error('[couple/accept-invite] bind after signup', bindErr);
    return NextResponse.json({ error: bindErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email });
}
