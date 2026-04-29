import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/couples/[id]/impersonate
 *
 * Returns a Supabase magic-link URL that the admin can open in a new tab to
 * sign into the couple's account. We use `auth.admin.generateLink` with type
 * `magiclink`, which yields a single-use action_link that, when followed,
 * establishes the couple's session in the admin's browser.
 *
 * This leaves the admin session intact in the original tab.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Look up the couple's email so we can issue a magic link
  const { data: userResp, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !userResp?.user?.email) {
    console.error('[admin/couples/impersonate] getUserById:', getErr);
    return NextResponse.json({ error: 'Couple not found' }, { status: 404 });
  }
  const email = userResp.user.email;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const redirectTo = `${appUrl}/couple/dashboard`;

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  if (error || !data?.properties?.action_link) {
    console.error('[admin/couples/impersonate] generateLink:', error);
    return NextResponse.json({ error: error?.message ?? 'Could not generate link' }, { status: 500 });
  }

  return NextResponse.json({
    url: data.properties.action_link,
    email,
  });
}
