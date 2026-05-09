import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { isPlatformFortisMerchantConfigured } from '@/lib/platform-billing';
import { defaultNavPermissionsAllTrue } from '@/lib/directory-nav-registry';
import { buildPlanNavPayloadFromEditor } from '@/lib/directory-plans-venue';
import { coerceTrialUnit } from '@/lib/directory-trial';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET() {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: plans, error: pErr } = await supabaseAdmin
    .from('directory_plans')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const { data: features, error: fErr } = await supabaseAdmin
    .from('directory_feature_definitions')
    .select('id, feature_key, label, category, sort_order')
    .order('sort_order', { ascending: true });
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });

  return NextResponse.json({
    plans: plans ?? [],
    features: features ?? [],
    platformFortisMerchantIdConfigured: isPlatformFortisMerchantConfigured(),
  });
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: {
    name?: string;
    slug?: string;
    description?: string | null;
    sort_order?: number;
    is_default?: boolean;
    price_monthly_cents?: number | null;
    fortis_merchant_id?: string | null;
    feature_flags?: Record<string, boolean>;
    nav_permissions?: Record<string, boolean>;
    trial_period_value?: number | null;
    trial_period_unit?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  const slug = (body.slug || '').trim().toLowerCase();
  if (!name || !slug) return NextResponse.json({ error: 'name and slug required' }, { status: 400 });
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase letters, numbers, hyphens' }, { status: 400 });
  }

  const mergedNav = {
    ...defaultNavPermissionsAllTrue(),
    ...(body.nav_permissions && typeof body.nav_permissions === 'object' ? body.nav_permissions : {}),
  };
  const { nav_permissions, feature_flags: derivedFlags } = buildPlanNavPayloadFromEditor(mergedNav);
  const feature_flags =
    body.feature_flags && typeof body.feature_flags === 'object' && Object.keys(body.feature_flags).length > 0
      ? body.feature_flags
      : derivedFlags;

  if (body.is_default === true) {
    await supabaseAdmin.from('directory_plans').update({ is_default: false });
  }

  const trialUnit = coerceTrialUnit(body.trial_period_unit ?? null);
  const trialValue =
    typeof body.trial_period_value === 'number' && body.trial_period_value >= 0
      ? Math.floor(body.trial_period_value)
      : 0;

  const insertPayload: Record<string, unknown> = {
    name,
    slug,
    description: body.description?.trim() || null,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    is_default: body.is_default === true,
    price_monthly_cents:
      typeof body.price_monthly_cents === 'number' && body.price_monthly_cents >= 0
        ? Math.round(body.price_monthly_cents)
        : null,
    fortis_merchant_id: body.fortis_merchant_id?.trim() || null,
    nav_permissions,
    feature_flags,
    trial_period_value: trialValue,
    trial_period_unit: trialUnit,
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabaseAdmin
    .from('directory_plans')
    .insert(insertPayload)
    .select('*')
    .single();

  // Migration 093 not yet applied — retry without trial columns so admins can
  // still create plans before running the migration.
  let trialSkipped = false;
  if (error && /trial_period_(value|unit)/.test(error.message)) {
    trialSkipped = true;
    delete insertPayload.trial_period_value;
    delete insertPayload.trial_period_unit;
    const retry = await supabaseAdmin
      .from('directory_plans')
      .insert(insertPayload)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'A plan with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { plan: data, ...(trialSkipped ? { trialSkipped: true } : {}) },
    { status: 201 },
  );
}
