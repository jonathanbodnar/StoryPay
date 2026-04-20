import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { buildPlanNavPayloadFromEditor } from '@/lib/directory-plans-venue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (typeof body.slug === 'string') {
    const s = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
    }
    updates.slug = s;
  }
  if (body.description !== undefined) {
    updates.description = body.description === null ? null : String(body.description).trim();
  }
  if (typeof body.sort_order === 'number') updates.sort_order = body.sort_order;
  if (typeof body.is_default === 'boolean') {
    updates.is_default = body.is_default;
    if (body.is_default) {
      await supabaseAdmin.from('directory_plans').update({ is_default: false }).neq('id', id);
    }
  }
  if (body.price_monthly_cents !== undefined) {
    updates.price_monthly_cents =
      body.price_monthly_cents === null
        ? null
        : Math.max(0, Math.round(Number(body.price_monthly_cents)));
  }
  if (body.stripe_price_id !== undefined) {
    updates.stripe_price_id = body.stripe_price_id === null ? null : String(body.stripe_price_id).trim();
  }
  if (body.fortis_merchant_id !== undefined) {
    updates.fortis_merchant_id =
      body.fortis_merchant_id === null || String(body.fortis_merchant_id).trim() === ''
        ? null
        : String(body.fortis_merchant_id).trim();
  }
  if (
    body.nav_permissions !== undefined &&
    typeof body.nav_permissions === 'object' &&
    body.nav_permissions !== null
  ) {
    const { nav_permissions, feature_flags } = buildPlanNavPayloadFromEditor(
      body.nav_permissions as Record<string, boolean>,
    );
    updates.nav_permissions = nav_permissions;
    updates.feature_flags = feature_flags;
  } else if (body.feature_flags !== undefined && typeof body.feature_flags === 'object' && body.feature_flags !== null) {
    updates.feature_flags = body.feature_flags;
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('directory_plans')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ plan: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabaseAdmin.from('directory_plans').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
