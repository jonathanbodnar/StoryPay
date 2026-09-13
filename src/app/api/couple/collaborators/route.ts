import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sendWeddingPlannerCollaboratorInviteEmail } from '@/lib/wedding-planner-emails';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

/** How many people a couple may invite into their Wedding Planner (excludes the
 *  venue-assigned coordinator, which is its own separate slot). */
export const MAX_COUPLE_COLLABORATORS = 5;

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function accessSummaryFor(level: 'view' | 'edit'): string {
  return level === 'edit'
    ? 'guests, seating, the timeline, checklist, vendors and more (everything except the private budget)'
    : 'viewing guests, seating, the timeline, checklist, vendors and more';
}

const COLLAB_COLUMNS =
  'id, invited_by, role, name, email, phone, access_level, status, collaborator_user_id, created_at, accepted_at';

/** GET — list this wedding's collaborators (owner only). */
export async function GET(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const wedding = gate.ctx.wedding;

  const { data, error } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .select(COLLAB_COLUMNS)
    .eq('couple_wedding_id', wedding.id)
    .neq('status', 'revoked')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[couple/collaborators GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Array<{ invited_by: string }>;
  const coupleInvited = rows.filter((r) => r.invited_by === 'couple').length;
  return NextResponse.json({
    collaborators: rows,
    max: MAX_COUPLE_COLLABORATORS,
    remaining: Math.max(0, MAX_COUPLE_COLLABORATORS - coupleInvited),
  });
}

/** POST — invite a new collaborator (owner only). Body: { name, email, phone, access_level }. */
export async function POST(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const wedding = gate.ctx.wedding;

  let body: { name?: string; email?: string; phone?: string; access_level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim().slice(0, 120);
  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200);
  const phone = (body.phone ?? '').trim().slice(0, 40);
  const accessLevel: 'view' | 'edit' = body.access_level === 'edit' ? 'edit' : 'view';

  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (!email || !isEmail(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: 'A phone number is required.' }, { status: 400 });

  // Enforce the max-5 cap over non-revoked, couple-invited rows.
  const { data: existing } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .select('id, email, status, invited_by')
    .eq('couple_wedding_id', wedding.id)
    .neq('status', 'revoked');
  const rows = (existing ?? []) as Array<{ email: string | null; status: string; invited_by: string }>;

  const coupleInvited = rows.filter((r) => r.invited_by === 'couple').length;
  if (coupleInvited >= MAX_COUPLE_COLLABORATORS) {
    return NextResponse.json(
      { error: `You can invite up to ${MAX_COUPLE_COLLABORATORS} people. Remove someone first to add another.` },
      { status: 409 },
    );
  }
  if (rows.some((r) => (r.email ?? '').toLowerCase() === email)) {
    return NextResponse.json({ error: 'That person has already been invited.' }, { status: 409 });
  }

  const token = randomBytes(24).toString('hex');
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .insert({
      couple_wedding_id: wedding.id,
      invited_by: 'couple',
      role: null,
      name,
      email,
      phone,
      access_level: accessLevel,
      status: 'invited',
      invite_token: token,
    })
    .select(COLLAB_COLUMNS)
    .single();

  if (insErr || !inserted) {
    console.error('[couple/collaborators POST]', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Could not create the invite.' }, { status: 500 });
  }

  // Look up the inviting couple's name + venue for the email.
  const [{ data: profile }, { data: venue }] = await Promise.all([
    supabaseAdmin
      .from('couple_profiles')
      .select('display_name, first_name, last_name, partner_first_name')
      .eq('id', wedding.couple_id)
      .maybeSingle(),
    supabaseAdmin.from('venues').select('name, brand_email').eq('id', wedding.venue_id).maybeSingle(),
  ]);
  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; partner_first_name?: string | null }
    | null;
  const inviterName =
    [p?.first_name, p?.partner_first_name].filter(Boolean).join(' & ').trim() ||
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() ||
    p?.display_name?.trim() ||
    'Your couple';
  const venueName = (venue as { name?: string | null } | null)?.name?.trim() || 'your venue';
  const brandEmail = (venue as { brand_email?: string | null } | null)?.brand_email?.trim() || undefined;

  const acceptUrl = `${APP_URL}/couple/accept-invite?token=${token}`;
  const sendResult = await sendWeddingPlannerCollaboratorInviteEmail({
    toEmail: email,
    inviteeFirstName: name.split(/\s+/)[0] || '',
    inviterName,
    venueName,
    accessSummary: accessSummaryFor(accessLevel),
    acceptUrl,
    brandEmail,
  });

  if (!sendResult.success) {
    return NextResponse.json(
      { error: `Invite created but the email failed to send: ${sendResult.error || 'unknown error'}`, collaborator: inserted },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, collaborator: inserted });
}

/** PATCH — change a collaborator's access level (owner only). Body: { id, access_level }. */
export async function PATCH(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const wedding = gate.ctx.wedding;

  let body: { id?: string; access_level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const id = (body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const accessLevel: 'view' | 'edit' = body.access_level === 'edit' ? 'edit' : 'view';

  const { data: updated, error } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .update({ access_level: accessLevel })
    .eq('id', id)
    .eq('couple_wedding_id', wedding.id)
    .neq('status', 'revoked')
    .select(COLLAB_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[couple/collaborators PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, collaborator: updated });
}

/** DELETE — revoke a collaborator (owner only, soft-delete). Body/query: { id }. */
export async function DELETE(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const wedding = gate.ctx.wedding;

  let id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!id) {
    try {
      const body = (await request.json()) as { id?: string };
      id = (body.id ?? '').trim();
    } catch {
      /* no body is fine — fall through to the missing-id error */
    }
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Soft-delete: mark revoked (recoverable) and unbind the auth user so their
  // access resolves to none immediately.
  const { error } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('couple_wedding_id', wedding.id);

  if (error) {
    console.error('[couple/collaborators DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
