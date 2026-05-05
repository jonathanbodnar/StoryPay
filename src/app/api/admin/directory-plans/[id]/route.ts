import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { buildPlanNavPayloadFromEditor } from '@/lib/directory-plans-venue';
import { coerceTrialUnit } from '@/lib/directory-trial';

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
  if (typeof body.is_public === 'boolean') {
    updates.is_public = body.is_public;
  }
  if (typeof body.is_legacy === 'boolean') {
    updates.is_legacy = body.is_legacy;
  }
  if (typeof body.hide_header === 'boolean') {
    updates.hide_header = body.hide_header;
  }
  if (body.highlight_label !== undefined) {
    const label = typeof body.highlight_label === 'string' ? body.highlight_label.trim() : null;
    updates.highlight_label = label || null;
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
  if (body.trial_period_value !== undefined) {
    const v = Number(body.trial_period_value);
    if (Number.isFinite(v) && v >= 0) {
      updates.trial_period_value = Math.floor(v);
    } else {
      return NextResponse.json({ error: 'Invalid trial_period_value' }, { status: 400 });
    }
  }
  if (body.trial_period_unit !== undefined) {
    updates.trial_period_unit = coerceTrialUnit(body.trial_period_unit as string | null);
  }

  // Extra feature_flags keys (e.g. addon_verified_included,
  // addon_sponsored_included) need to survive a nav_permissions update — the
  // nav editor only owns the coarse "section" flags, not arbitrary booleans.
  // When both are sent we layer them: nav-derived base + explicit extras on
  // top.  When only feature_flags is sent we accept it as-is.
  const explicitFeatureFlags =
    body.feature_flags !== undefined &&
    typeof body.feature_flags === 'object' &&
    body.feature_flags !== null
      ? (body.feature_flags as Record<string, unknown>)
      : null;

  if (
    body.nav_permissions !== undefined &&
    typeof body.nav_permissions === 'object' &&
    body.nav_permissions !== null
  ) {
    const { nav_permissions, feature_flags } = buildPlanNavPayloadFromEditor(
      body.nav_permissions as Record<string, boolean>,
    );
    updates.nav_permissions = nav_permissions;
    updates.feature_flags = explicitFeatureFlags
      ? { ...feature_flags, ...explicitFeatureFlags }
      : feature_flags;
  } else if (explicitFeatureFlags) {
    // Read-modify-write so we don't drop unrelated keys when the caller only
    // wants to update a few flags (e.g. just the addon includes).
    const { data: current } = await supabaseAdmin
      .from('directory_plans')
      .select('feature_flags')
      .eq('id', id)
      .maybeSingle();
    const base = (current?.feature_flags as Record<string, unknown> | null) ?? {};
    updates.feature_flags = { ...base, ...explicitFeatureFlags };
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  let { data, error } = await supabaseAdmin
    .from('directory_plans')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  // Schema-not-yet-applied path: drop trial columns and retry so admins can
  // still edit other fields before running migration 093.
  let trialSkipped = false;
  if (error && /trial_period_(value|unit)/.test(error.message)) {
    trialSkipped = true;
    delete (updates as Record<string, unknown>).trial_period_value;
    delete (updates as Record<string, unknown>).trial_period_unit;
    const retry = await supabaseAdmin
      .from('directory_plans')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  // Migration 106 not yet applied — drop hide_header and retry.
  if (error && /hide_header/.test(error.message)) {
    delete (updates as Record<string, unknown>).hide_header;
    const retry = await supabaseAdmin
      .from('directory_plans')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    plan: data,
    ...(trialSkipped ? { trialSkipped: true } : {}),
  });
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
